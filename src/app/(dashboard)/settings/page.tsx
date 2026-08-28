'use client'

import { useState, useEffect, useRef } from 'react'
import Navbar from '@/components/Navbar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

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
    }
  }, [settings])

  /**
   * Todo lo de MONEDAS se fue con su bloque.
   *
   * Era un campo donde alguien escribía la tasa CUP a mano, la misma para las ocho
   * sucursales y sin nadie que la refrescara. Ahora la mantiene Accesos por sucursal,
   * sacándola de Entrega, igual que PEDIDO. Dos sitios donde escribir el mismo número es
   * la forma garantizada de que acaben diciendo cosas distintas.
   */

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

  /**
   * El recálculo a mano se fue con su botón.
   *
   * Prometía "todos los pedidos" y hacía 2.000 de 50.683: el endpoint se llevaba el tope
   * de PEDIDO y contestaba como si hubiera terminado. Acotarlo a los últimos días lo hacía
   * honesto, pero seguía siendo un botón que hay que explicar para que no engañe.
   *
   * El catálogo lo recotiza el proceso de sincronización en cada vuelta, con la
   * configuración que haya en ese momento. No hace falta pedírselo.
   */

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

  return (
    <div className="flex flex-col">
      <Navbar title={t('set.title')} />
      <div className="p-6 space-y-6">

        {/* El bloque de MONEDAS se fue.
            Era un campo donde alguien escribía la tasa CUP a mano: el mismo número para
            las ocho sucursales y sin nadie que lo refrescara. Con eso, un domicilio de
            Santiago se convertía con la tasa de La Habana —creíble, y mal— y encima
            discrepaba de PEDIDO, que sí la trae de Entrega.
            La tasa la mantiene ahora Accesos, por sucursal, sacándola de Entrega. Aquí no
            hay nada que teclear: dos sitios donde escribir el mismo número es la forma
            garantizada de que acaben diciendo cosas distintas. */}
        {/* La ÚNICA fórmula de precio del sistema. Se llamaba "envío a domicilio
            individual" de cuando había otra fórmula para el cotizador de uno; ésa se
            retiró junto con el endpoint, así que ya no hay a qué distinguirla.
            El generador de rutas tampoco tiene fórmula propia: sólo agrupa + capacidad. */}
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

          {/* El botón de recalcular SE VA.
              Prometía "todos los pedidos" y hacía 2.000 de 50.683; acotado a los últimos
              30 días seguía siendo un botón que hay que explicar para que no engañe. Lo
              que de verdad recalcula el catálogo es el proceso de sincronización, que lo
              hace solo. Un botón que hay que acompañar de una nota diciendo lo que NO
              hace es un botón que sobra. */}
        </div>
      </div>
    </div>
  )
}
