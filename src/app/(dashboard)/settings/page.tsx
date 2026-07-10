'use client'

import { useState, useEffect, useRef } from 'react'
import Navbar from '@/components/Navbar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import { CurrencyDef } from '@/lib/useCurrency'

export default function SettingsPage() {
  const { token } = useAppStore()
  const t = useT()
  const queryClient = useQueryClient()
  const [domForm, setDomForm] = useState({
    domBaseFee: '0',
    domCostPerKm: '0',
    domCostPerKg: '0',
    domIncludedKm: '0',
    domMinFee: '0',
    domRoundTo: '0',
    domTipoCambio: '700',
    domFactorCapacidad: '0.5',
  })
  // La tasa se edita como TEXTO (permite vaciar el campo y escribir libre); se convierte
  // a número solo al guardar (cleanList). Si se guardara número, borrar lo dejaba en 0.
  const [currencies, setCurrencies] = useState<Array<{ code: string; rate: number | string }>>([])
  const [curSaved, setCurSaved] = useState(false)
  const [homeSaved, setHomeSaved] = useState(false)
  // Initialize local form state from the server only ONCE. Re-syncing on every
  // refetch (e.g. window focus) would wipe edits the user hasn't saved yet.
  const inited = useRef(false)

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await axios.get('/api/settings', { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    enabled: !!token
  })

  useEffect(() => {
    if (settings && !inited.current) {
      inited.current = true
      setDomForm({
        domBaseFee: (settings.domBaseFee ?? 0).toString(),
        domCostPerKm: (settings.domCostPerKm ?? 0).toString(),
        domCostPerKg: (settings.domCostPerKg ?? 0).toString(),
        domIncludedKm: (settings.domIncludedKm ?? 0).toString(),
        domMinFee: (settings.domMinFee ?? 0).toString(),
        domRoundTo: (settings.domRoundTo ?? 0).toString(),
        domTipoCambio: (settings.domTipoCambio ?? 700).toString(),
        domFactorCapacidad: (settings.domFactorCapacidad ?? 0.5).toString(),
      })
      const list: CurrencyDef[] = Array.isArray(settings.currencies) ? settings.currencies : []
      // Seed with legacy CUP rate the first time so existing setup is preserved.
      if (list.length === 0 && settings.cupRate) {
        setCurrencies([{ code: 'CUP', rate: settings.cupRate }])
      } else {
        setCurrencies(list)
      }
    }
  }, [settings])

  const updateCurrencies = useMutation({
    mutationFn: async (payload: unknown) => {
      const res = await axios.put('/api/settings', payload, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setCurSaved(true)
      setTimeout(() => setCurSaved(false), 3000)
    }
  })

  const cleanList = (list: Array<{ code: string; rate: number | string }>): CurrencyDef[] =>
    list
      .map((c) => ({ code: String(c.code).trim().toUpperCase(), rate: Number(c.rate) }))
      .filter((c) => c.code && c.code !== 'USD' && Number.isFinite(c.rate) && c.rate > 0)

  const cleanCurrencies = () => cleanList(currencies)

  // Delete a row and persist immediately.
  const deleteCurrencyRow = (i: number) => {
    const next = currencies.filter((_, idx) => idx !== i)
    setCurrencies(next)
    updateCurrencies.mutate({ currencies: cleanList(next) })
  }

  const updateHome = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await axios.put('/api/settings', data, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setHomeSaved(true)
      setTimeout(() => setHomeSaved(false), 3000)
    }
  })

  // Recálculo de TODOS los pedidos con la configuración vigente (tras cambiar el mínimo,
  // el factor, la tarifa del vehículo o la tasa CUP).
  const [recomputeMsg, setRecomputeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const recompute = useMutation({
    mutationFn: async () => {
      const res = await axios.post('/api/admin/recompute', {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 300000 })
      return res.data as { total: number; actualizados: number; sucursal: string }
    },
    onSuccess: (d) => {
      setRecomputeMsg({ ok: true, text: `Listo: ${d.actualizados} de ${d.total} pedidos recalculados (${d.sucursal}).` })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.error || err.message) : 'Error al recalcular'
      setRecomputeMsg({ ok: false, text: msg })
    },
  })

  const handleSubmitHome = (e: React.FormEvent) => {
    e.preventDefault()
    // La fórmula oficial del domicilio usa el tipo de cambio (CUP por 1 USD). El costo por
    // km y la capacidad salen del vehículo marcado como referencia en cada sucursal.
    // Guardar el tipo de cambio marca la fórmula como configurada.
    // El tipo de cambio ya vive en "Monedas" (tasa CUP); aquí el mínimo y el factor.
    updateHome.mutate({
      domMinFee: parseFloat(domForm.domMinFee) || 0,
      domFactorCapacidad: parseFloat(domForm.domFactorCapacidad) || 0.5,
    })
  }

  const saveCurrencies = () => {
    const clean = cleanCurrencies()
    setCurrencies(clean)
    updateCurrencies.mutate({ currencies: clean })
  }

  return (
    <div className="flex flex-col">
      <Navbar title={t('set.title')} />
      <div className="p-6 space-y-6">

        {/* Monedas — bloque prominente arriba */}
        <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-yellow-400">
          <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
            <Icon icon="mdi:cash-multiple" className="text-xl text-yellow-500" />
            {t('set.currenciesTitle')}
          </h3>
          <p className="text-xs text-gray-500 mb-4">{t('set.currenciesHelp')}</p>

          <div className="space-y-2">
            <div className="grid grid-cols-[100px_1fr_auto] gap-3 text-xs font-medium text-gray-500 px-1">
              <span>{t('set.code')}</span>
              <span>{t('set.unitsPerUsd')}</span>
              <span></span>
            </div>
            {currencies.map((c, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr_auto] gap-3 items-center">
                <input
                  type="text"
                  value={c.code}
                  onChange={(e) => setCurrencies(currencies.map((x, idx) => idx === i ? { ...x, code: e.target.value.toUpperCase() } : x))}
                  placeholder="CUP"
                  maxLength={5}
                  className="px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm font-mono uppercase"
                />
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={c.rate}
                  onChange={(e) => setCurrencies(currencies.map((x, idx) => idx === i ? { ...x, rate: e.target.value } : x))}
                  placeholder="320"
                  className="px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={saveCurrencies}
                    disabled={updateCurrencies.isPending}
                    className="text-green-600 hover:text-green-700 px-2 disabled:opacity-50"
                    title={t('common.save')}
                  >
                    <Icon icon="mdi:content-save-outline" className="text-lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCurrencyRow(i)}
                    disabled={updateCurrencies.isPending}
                    className="text-red-400 hover:text-red-600 px-2 disabled:opacity-50"
                    title={t('common.delete')}
                  >
                    <Icon icon="mdi:trash-can-outline" className="text-lg" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => setCurrencies([...currencies, { code: '', rate: '' }])}
              className="text-sm text-blue-600 hover:underline"
            >
              {t('set.addCurrency')}
            </button>
            <button
              type="button"
              onClick={saveCurrencies}
              disabled={updateCurrencies.isPending}
              className="ml-auto px-5 py-2.5 bg-yellow-400 text-gray-900 rounded-xl font-semibold hover:bg-yellow-500 disabled:opacity-50"
            >
              {updateCurrencies.isPending ? t('set.saving') : t('set.saveCurrencies')}
            </button>
          </div>

          {curSaved && (
            <div className="mt-3 bg-green-50 text-green-700 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
              <Icon icon="mdi:check-circle" className="text-lg" /> {t('set.currenciesSaved')}
            </div>
          )}
        </div>

        {/* Envío a domicilio individual — ÚNICA fórmula de precio del sistema.
            El generador de rutas no tiene fórmula propia: solo agrupa + capacidad. */}
        <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-primary">
          <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
            <Icon icon="mdi:moped" className="text-xl text-primary" />
            {t('set.homeTitle')}
          </h3>
          <p className="text-xs text-gray-500 mb-4">{t('set.homeHelp')}</p>

          <form onSubmit={handleSubmitHome} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Base del domicilio
                <span className="ml-1 text-xs text-gray-400">(se suma al costo, en USD)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={domForm.domMinFee}
                  onChange={(e) => setDomForm({ ...domForm, domMinFee: e.target.value })}
                  className="w-full pl-8 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Se SUMA al costo de cada domicilio (para que no salga gratis y mantenga variación). Precio = base + costo. 0 = sin base.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Factor de capacidad
                <span className="ml-1 text-xs text-gray-400">(% promedio de carga del camión)</span>
              </label>
              <input
                type="number" step="0.05" min="0.1" max="1"
                value={domForm.domFactorCapacidad}
                onChange={(e) => setDomForm({ ...domForm, domFactorCapacidad: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">Se asume que el camión va a esta fracción de su capacidad en promedio. 0.5 = 50% (recomendado por el jefe). Menor = domicilios más caros.</p>
            </div>

            <div className="sm:col-span-2 flex items-end gap-3">
              {homeSaved && (
                <div className="bg-green-50 text-green-600 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                  <Icon icon="mdi:check-circle" className="text-lg" /> {t('set.homeSaved')}
                </div>
              )}
              <button
                type="submit"
                disabled={updateHome.isPending}
                className="ml-auto px-5 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {updateHome.isPending ? t('set.saving') : t('set.saveHome')}
              </button>
            </div>
          </form>

          <div className="mt-4 bg-gray-50 p-4 rounded-xl text-xs text-gray-700 space-y-2">
            <p className="font-semibold text-gray-800">Fórmula del costo del domicilio</p>
            <p className="font-mono text-[13px] text-gray-800">C = CKK × D × PP</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              <p><b className="font-mono">C</b> — <b>C</b>osto del domicilio (en CUP, se muestra también en USD).</p>
              <p><b className="font-mono">CKK</b> — <b>C</b>osto por <b>K</b>g por <b>K</b>m = costo_km(USD) × tasa_CUP ÷ (factor × capacidad del camión). El <b>factor</b> lo pones abajo (0.5 = 50%).</p>
              <p><b className="font-mono">D</b> — <b>D</b>istancia = 2 × (almacén → cliente) km (ida y vuelta).</p>
              <p><b className="font-mono">PP</b> — <b>P</b>eso del <b>P</b>edido = suma del peso de los productos (kg).</p>
            </div>
            <p className="text-gray-500 pt-1">El <b>costo por km</b> y la <b>capacidad</b> salen del vehículo con mayor CKK de la sucursal. La <b>tasa CUP</b> es la de «Monedas» (arriba). El precio final en USD = <b>base + (C ÷ tasa_CUP)</b> — la <b>base</b> (arriba) se suma para que ningún domicilio salga gratis.</p>
          </div>

          {/* Recalcular todos los pedidos con la configuración actual */}
          <div className="mt-4 border border-blue-100 bg-blue-50/60 rounded-xl p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 flex items-center gap-2">
                  <Icon icon="mdi:calculator-variant-outline" className="text-lg text-primary" />
                  Recalcular el domicilio de todos los pedidos
                </p>
                <p className="text-xs text-gray-500 mt-1 max-w-xl">
                  Aplica la configuración vigente (mínimo, factor, tarifa del vehículo y tasa CUP)
                  a <b>todos</b> los pedidos con ubicación. Úsalo cuando cambies algún valor de la
                  fórmula. Puede tardar unos segundos.
                </p>
              </div>
              <button
                type="button"
                disabled={recompute.isPending}
                onClick={() => { setRecomputeMsg(null); recompute.mutate() }}
                className="px-5 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shrink-0"
              >
                {recompute.isPending ? (
                  <><Icon icon="mdi:loading" className="animate-spin text-lg" /> Recalculando…</>
                ) : (
                  <><Icon icon="mdi:refresh" className="text-lg" /> Recalcular todos</>
                )}
              </button>
            </div>
            {recomputeMsg && (
              <p className={`mt-3 text-sm font-medium ${recomputeMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {recomputeMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
