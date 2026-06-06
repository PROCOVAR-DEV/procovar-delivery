'use client'

import Navbar from '@/components/Navbar'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import Link from 'next/link'

function StatCard({ label, value, icon, color, sub }: { label: string; value: string | number; icon: string; color: string; sub?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-md p-6 border-l-4 ${color}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <Icon icon={icon} className="text-4xl text-gray-300" />
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
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            label={t('dash.totalOrders')}
            value={stats?.totalOrders || 0}
            icon="mdi:package-variant-closed"
            color="border-blue-500"
          />
          <StatCard
            label={t('dash.totalRevenue')}
            value={format(stats?.totalRevenue || 0)}
            icon="mdi:currency-usd"
            color="border-green-500"
            sub={stats?.totalOrders > 0 ? t('dash.avgPerOrder', { v: format(stats.avgPrice || 0) }) : undefined}
          />
          <StatCard
            label={t('dash.vehiclesRegistered')}
            value={stats?.totalVehicles || 0}
            icon="mdi:truck-outline"
            color="border-purple-500"
            sub={t('dash.totalWeightDelivered', { v: (stats?.totalWeight || 0).toFixed(0) })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Icon icon="mdi:chart-bar" className="text-xl text-primary" /> {t('dash.summary')}
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">{t('dash.rowOrders')}</span>
                <span className="font-semibold">{stats?.totalOrders || 0}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">{t('dash.rowRevenue')}</span>
                <span className="font-semibold text-green-600">{format(stats?.totalRevenue || 0)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600">{t('dash.rowAvg')}</span>
                <span className="font-semibold text-blue-600">{format(stats?.avgPrice || 0)}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">{t('dash.rowWeight')}</span>
                <span className="font-semibold">{(stats?.totalWeight || 0).toFixed(1)} kg</span>
              </div>
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
