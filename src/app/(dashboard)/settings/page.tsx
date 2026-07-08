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
  })
  const [currencies, setCurrencies] = useState<CurrencyDef[]>([])
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

  const cleanList = (list: CurrencyDef[]) =>
    list
      .map((c) => ({ code: c.code.trim().toUpperCase(), rate: Number(c.rate) }))
      .filter((c) => c.code && c.code !== 'USD' && c.rate > 0)

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

  const handleSubmitHome = (e: React.FormEvent) => {
    e.preventDefault()
    updateHome.mutate({
      domBaseFee: parseFloat(domForm.domBaseFee) || 0,
      domCostPerKm: parseFloat(domForm.domCostPerKm) || 0,
      domCostPerKg: parseFloat(domForm.domCostPerKg) || 0,
      domIncludedKm: parseFloat(domForm.domIncludedKm) || 0,
      domMinFee: parseFloat(domForm.domMinFee) || 0,
      domRoundTo: parseFloat(domForm.domRoundTo) || 0,
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
                  onChange={(e) => setCurrencies(currencies.map((x, idx) => idx === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x))}
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
              onClick={() => setCurrencies([...currencies, { code: '', rate: 0 }])}
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

          <form onSubmit={handleSubmitHome} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('set.domBaseFee')}</label>
              <input
                type="number" step="0.01" min="0"
                value={domForm.domBaseFee}
                onChange={(e) => setDomForm({ ...domForm, domBaseFee: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('set.domCostPerKm')}
                <span className="ml-1 text-xs text-gray-400">{t('set.domCostPerKmHint')}</span>
              </label>
              <input
                type="number" step="0.01" min="0"
                value={domForm.domCostPerKm}
                onChange={(e) => setDomForm({ ...domForm, domCostPerKm: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('set.domCostPerKg')}</label>
              <input
                type="number" step="0.01" min="0"
                value={domForm.domCostPerKg}
                onChange={(e) => setDomForm({ ...domForm, domCostPerKg: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('set.domIncludedKm')}</label>
              <input
                type="number" step="0.1" min="0"
                value={domForm.domIncludedKm}
                onChange={(e) => setDomForm({ ...domForm, domIncludedKm: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('set.domMinFee')}</label>
              <input
                type="number" step="0.01" min="0"
                value={domForm.domMinFee}
                onChange={(e) => setDomForm({ ...domForm, domMinFee: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('set.domRoundTo')}</label>
              <input
                type="number" step="0.01" min="0"
                value={domForm.domRoundTo}
                onChange={(e) => setDomForm({ ...domForm, domRoundTo: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-1">
              {homeSaved && (
                <div className="bg-green-50 text-green-600 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                  <Icon icon="mdi:check-circle" className="text-lg" /> {t('set.homeSaved')}
                </div>
              )}
              <button
                type="submit"
                disabled={updateHome.isPending}
                className="ml-auto px-5 py-2.5 bg-primary text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {updateHome.isPending ? t('set.saving') : t('set.saveHome')}
              </button>
            </div>
          </form>

          <div className="mt-4 bg-gray-50 p-4 rounded-xl font-mono text-xs text-gray-700 space-y-1">
            <p>km_cobrables = max(0, distancia − km_incluidos)</p>
            <p>precio = base + (km_cobrables × 2 × costo_km) + (peso × costo_kg)</p>
            <p>precio = max(precio, mínimo), luego redondeo</p>
          </div>
        </div>
      </div>
    </div>
  )
}
