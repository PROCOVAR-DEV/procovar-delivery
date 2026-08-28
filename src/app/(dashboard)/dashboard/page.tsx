'use client'

import Navbar from '@/components/Navbar'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import Link from 'next/link'

function StatCard({ label, value, icon, color, accent, sub }: { label: string; value: string | number; icon: string; color: string; accent: string; sub?: string }) {
  return (
    <div className="group bg-white rounded-2xl shadow-md p-6 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
      <span className={`absolute inset-x-0 top-0 h-1 ${color}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft/70">{label}</p>
          <p className="text-[2.1rem] leading-none font-extrabold font-display text-ink mt-2.5 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-ink-soft/70 mt-2">{sub}</p>}
        </div>
        <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon icon={icon} className="text-2xl" />
        </span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { token } = useAppStore()
  const { format } = useCurrency()
  const t = useT()

  const { data: stats } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await axios.get('/api/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    enabled: !!token
  })

  return (
    <div className="flex flex-col">
      <Navbar title={t('dash.title')} />
      <div className="p-3 sm:p-6">
        {/*
          Lo primero: lo que PIDE HACER ALGO.
          
          Antes arriba iban el total de órdenes, los ingresos y el precio medio — tres
          números que no cambian de un día para otro y que no le dicen a nadie qué hacer.
          Y los ingresos ni siquiera son de delivery: el precio de la mercancía es de
          PEDIDO, y tenerlo en dos pantallas invita a cuadrarlas.
          
          Lo que manda aquí es cuántos pedidos esperan ruta. Ese sí se mira cada mañana.
        */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Pedidos sin ruta"
            value={stats?.sinRuta ?? 0}
            icon="mdi:package-variant-closed-remove"
            color={stats?.sinRuta ? 'bg-amber-500' : 'bg-primary'}
            accent={stats?.sinRuta ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'}
            sub={`${(stats?.pesoPendiente ?? 0).toFixed(0)} kg por mover`}
          />
          <StatCard
            label="Rutas en marcha"
            value={stats?.rutasActivas ?? 0}
            icon="mdi:map-marker-path"
            color="bg-primary"
            accent="bg-primary/10 text-primary"
          />
          <StatCard
            label="Entregados hoy"
            value={stats?.entregadosHoy ?? 0}
            icon="mdi:check-circle-outline"
            color="bg-secondary"
            accent="bg-secondary/10 text-secondary"
          />
          <StatCard
            label="Vehículos"
            value={`${stats?.vehiculosEnRuta ?? 0} / ${stats?.totalVehicles ?? 0}`}
            icon="mdi:truck-outline"
            color="bg-accent"
            accent="bg-accent/10 text-accent"
            sub="en ruta / total"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/*
            Dónde está lo pendiente.
            
            "412 sin ruta" no dice por dónde empezar; repartido por sucursal, sí. Es la
            diferencia entre un número y una decisión.
          */}
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Icon icon="mdi:office-building-marker-outline" className="text-xl text-primary" />
              Pendiente por sucursal
            </h3>
            {(stats?.porSucursal?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-500 py-4">No queda nada sin ruta.</p>
            ) : (
              <div className="space-y-2">
                {stats.porSucursal.map((s: { sucursal: string; pedidos: number; pesoKg: number }) => (
                  <div key={s.sucursal} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <span className="flex-1 min-w-0 truncate text-gray-700">{s.sucursal}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{s.pesoKg.toFixed(0)} kg</span>
                    <span className="font-semibold tabular-nums w-10 text-right">{s.pedidos}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center pt-3 mt-2 border-t text-sm">
              <span className="text-gray-500">Domicilios cobrados</span>
              <span className="font-semibold text-green-600">{format(stats?.totalDomicilios ?? 0)}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-md p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Icon icon="mdi:lightning-bolt" className="text-xl text-primary" /> {t('dash.quickActions')}
            </h3>
            <div className="space-y-3">
              <Link href="/routes" className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
                <Icon icon="mdi:map-marker-path" className="text-xl text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{t('dash.planRoutes')}</span>
              </Link>
              <Link href="/reports" className="flex items-center gap-3 p-3 bg-green-50 rounded-xl hover:bg-green-100 transition-colors">
                <Icon icon="mdi:chart-bar" className="text-xl text-green-600" />
                <span className="text-sm font-medium text-green-700">{t('dash.viewReports')}</span>
              </Link>
              <Link href="/vehicles" className="flex items-center gap-3 p-3 bg-yellow-50 rounded-xl hover:bg-yellow-100 transition-colors">
                <Icon icon="mdi:truck-cargo-container" className="text-xl text-yellow-600" />
                <span className="text-sm font-medium text-yellow-700">{t('dash.manageFleet')}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
