'use client'

import { useState } from 'react'
import Navbar from '@/components/Navbar'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import * as XLSX from 'xlsx'

interface Vehicle {
  id: string
  name: string
  plate: string | null
}

interface Order {
  id: string
  customerName: string
  address: string
  endAddress?: string | null
  weight: number
  price?: number | null
  segmentKm?: number | null
  createdAt: string
  routeName?: string | null
  vehicleName?: string | null
  vehiclePlate?: string | null
}

interface VehicleSummary {
  name: string
  plate: string | null
  count: number
  revenue: number
  weight: number
}

interface ReportData {
  orders: Order[]
  summary: { totalOrders: number; totalRevenue: number; totalWeight: number; avgPrice: number }
  byVehicle: VehicleSummary[]
}

type Tab = 'resumen' | 'vehiculos' | 'ordenes'

export default function ReportsPage() {
  const { token } = useAppStore()
  const { format, code, rate } = useCurrency()
  const t = useT()
  const [activeTab, setActiveTab] = useState<Tab>('resumen')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const res = await axios.get('/api/vehicles', { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    enabled: !!token,
  })

  const params = new URLSearchParams()
  if (dateFrom) params.set('from', dateFrom)
  if (dateTo) params.set('to', dateTo)
  if (vehicleFilter) params.set('vehicleId', vehicleFilter)

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ['reports', dateFrom, dateTo, vehicleFilter],
    queryFn: async () => {
      const res = await axios.get(`/api/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data
    },
    enabled: !!token,
  })

  const summary = data?.summary
  const orders = data?.orders || []
  const byVehicle = data?.byVehicle || []

  const clearFilters = () => { setDateFrom(''); setDateTo(''); setVehicleFilter('') }

  // Convert a USD amount into the selected display currency as a plain number (for Excel cells).
  const conv = (usd: number) => Math.round((usd || 0) * rate * 100) / 100
  const moneyCol = `(${code})`

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()

    // Sheet 1 — Resumen
    const resumen = [
      [t('xls.reportTitle')],
      [t('xls.generated'), new Date().toLocaleString()],
      [t('xls.dateFilter'), `${dateFrom || '—'} - ${dateTo || '—'}`],
      [t('xls.currency'), code],
      [],
      [t('rep.totalOrders'), summary?.totalOrders || 0],
      [`${t('rep.totalRevenue')} ${moneyCol}`, conv(summary?.totalRevenue || 0)],
      [`${t('rep.avgPrice')} ${moneyCol}`, conv(summary?.avgPrice || 0)],
      [`${t('rep.totalWeight')} (kg)`, Math.round((summary?.totalWeight || 0) * 10) / 10],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), t('rep.tabSummary'))

    // Sheet 2 — Por Vehículo
    const vehHeader = [t('rep.vehicle'), t('rep.colPlate'), t('rep.colOrders'), `${t('rep.colRevenue')} ${moneyCol}`, `${t('common.weight')} (kg)`, `${t('rep.colAvgOrder')} ${moneyCol}`]
    const vehRows = byVehicle.map((v) => [
      v.name, v.plate || '—', v.count, conv(v.revenue), Math.round(v.weight * 10) / 10, conv(v.count > 0 ? v.revenue / v.count : 0),
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vehHeader, ...vehRows]), t('rep.tabByVehicle'))

    // Sheet 3 — Órdenes
    const ordHeader = [t('common.date'), t('rep.colClient'), t('rep.colRoute'), t('rep.colDest'), t('rep.vehicle'), t('xls.kmFromStart'), `${t('common.weight')} (kg)`, `${t('common.price')} ${moneyCol}`]
    const ordRows = orders.map((o) => [
      new Date(o.createdAt).toLocaleDateString(),
      o.customerName,
      o.routeName || '—',
      o.endAddress || o.address,
      o.vehicleName || '—',
      o.segmentKm != null ? Math.round(o.segmentKm * 10) / 10 : '',
      o.weight,
      o.price != null ? conv(o.price) : '',
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ordHeader, ...ordRows]), t('rep.tabOrders'))

    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `reporte-procovar-${stamp}.xlsx`)
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'resumen', label: t('rep.tabSummary'), icon: 'mdi:chart-pie' },
    { key: 'vehiculos', label: t('rep.tabByVehicle'), icon: 'mdi:truck-outline' },
    { key: 'ordenes', label: t('rep.tabOrders'), icon: 'mdi:package-variant-closed' },
  ]

  return (
    <div className="flex flex-col">
      <Navbar title={t('rep.title')} />
      <div className="p-6 space-y-5">

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-md p-5">
          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2 text-sm">
            <Icon icon="mdi:filter-outline" className="text-lg text-primary" /> {t('rep.filters')}
          </h3>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.from')}</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.to')}</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('rep.vehicle')}</label>
              <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}
                className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
                <option value="">{t('rep.allVehicles')}</option>
                {(vehicles as Vehicle[]).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.plate ? ` (${v.plate})` : ''}</option>
                ))}
              </select>
            </div>
            {(dateFrom || dateTo || vehicleFilter) && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border rounded-xl">
                <Icon icon="mdi:close" className="text-base" /> {t('common.clear')}
              </button>
            )}
            <button onClick={exportExcel} disabled={isLoading || orders.length === 0}
              className="ml-auto flex items-center gap-2 text-sm bg-green-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-green-700 disabled:opacity-50">
              <Icon icon="mdi:microsoft-excel" className="text-base" /> {t('rep.export')}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <div className="flex border-b">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon icon={tab.icon} className="text-base" />
                {tab.label}
                {tab.key === 'ordenes' && orders.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                    {orders.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="p-16 text-center text-gray-400">
              <Icon icon="mdi:loading" className="text-4xl mx-auto mb-3 animate-spin" />
              <p>{t('rep.loading')}</p>
            </div>
          ) : (
            <div className="p-6">

              {/* TAB: RESUMEN */}
              {activeTab === 'resumen' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon icon="mdi:package-variant-closed" className="text-blue-500 text-xl" />
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{t('rep.totalOrders')}</p>
                      </div>
                      <p className="text-4xl font-bold text-gray-800">{summary?.totalOrders || 0}</p>
                    </div>
                    <div className="bg-green-50 rounded-2xl p-5 border border-green-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon icon="mdi:currency-usd" className="text-green-500 text-xl" />
                        <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">{t('rep.totalRevenue')}</p>
                      </div>
                      <p className="text-3xl font-bold text-gray-800">{format(summary?.totalRevenue || 0)}</p>
                    </div>
                    <div className="bg-purple-50 rounded-2xl p-5 border border-purple-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon icon="mdi:chart-line" className="text-purple-500 text-xl" />
                        <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">{t('rep.avgPrice')}</p>
                      </div>
                      <p className="text-3xl font-bold text-gray-800">{format(summary?.avgPrice || 0)}</p>
                    </div>
                    <div className="bg-yellow-50 rounded-2xl p-5 border border-yellow-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon icon="mdi:weight" className="text-yellow-500 text-xl" />
                        <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide">{t('rep.totalWeight')}</p>
                      </div>
                      <p className="text-4xl font-bold text-gray-800">{(summary?.totalWeight || 0).toFixed(1)}<span className="text-xl font-normal text-gray-500 ml-1">kg</span></p>
                    </div>
                  </div>

                  {/* Mini resumen por vehículo en el tab resumen */}
                  {byVehicle.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <Icon icon="mdi:truck-outline" className="text-primary" /> {t('rep.topVehicles')}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {byVehicle.slice(0, 3).map((v, i) => (
                          <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <Icon icon="mdi:truck-outline" className="text-blue-600 text-xl" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-800 truncate">{v.name}</p>
                              {v.plate && <p className="text-xs text-gray-400 font-mono">{v.plate}</p>}
                              <p className="text-sm text-green-700 font-semibold">{format(v.revenue)} · {v.count} órdenes</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {orders.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <Icon icon="mdi:file-chart-outline" className="text-5xl mx-auto mb-3" />
                      <p>{t('rep.noOrders')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: POR VEHÍCULO */}
              {activeTab === 'vehiculos' && (
                byVehicle.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icon icon="mdi:truck-outline" className="text-5xl mx-auto mb-3" />
                    <p>{t('rep.noVehicleData')}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.vehicle')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.colPlate')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('rep.colOrders')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('rep.colRevenue')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('rep.colWeight')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('rep.colAvgOrder')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byVehicle.map((v, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium flex items-center gap-2">
                              <Icon icon="mdi:truck-outline" className="text-gray-400" /> {v.name}
                            </td>
                            <td className="py-3 px-4 text-gray-500 font-mono text-xs">{v.plate || '—'}</td>
                            <td className="py-3 px-4 text-right font-semibold">{v.count}</td>
                            <td className="py-3 px-4 text-right font-semibold text-green-700">{format(v.revenue)}</td>
                            <td className="py-3 px-4 text-right">{v.weight.toFixed(1)} kg</td>
                            <td className="py-3 px-4 text-right text-blue-600 font-medium">
                              {format(v.count > 0 ? v.revenue / v.count : 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2">
                          <td colSpan={2} className="py-3 px-4 font-bold text-gray-700">{t('rep.totals')}</td>
                          <td className="py-3 px-4 text-right font-bold">{byVehicle.reduce((s, v) => s + v.count, 0)}</td>
                          <td className="py-3 px-4 text-right font-bold text-green-700">{format(byVehicle.reduce((s, v) => s + v.revenue, 0))}</td>
                          <td className="py-3 px-4 text-right font-bold">{byVehicle.reduce((s, v) => s + v.weight, 0).toFixed(1)} kg</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              )}

              {/* TAB: DETALLE DE ÓRDENES */}
              {activeTab === 'ordenes' && (
                orders.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icon icon="mdi:package-variant-closed-remove" className="text-5xl mx-auto mb-3" />
                    <p>No hay órdenes para los filtros seleccionados.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('common.date')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.colClient')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.colRoute')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.colDest')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">{t('rep.vehicle')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('common.weight')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600">{t('common.price')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((order) => (
                          <tr key={order.id} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(order.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-3 px-4 font-medium">{order.customerName}</td>
                            <td className="py-3 px-4 text-gray-600 max-w-[140px] truncate text-xs">{order.routeName || '—'}</td>
                            <td className="py-3 px-4 text-gray-600 max-w-[140px] truncate text-xs">{order.endAddress || order.address}</td>
                            <td className="py-3 px-4 text-gray-600 text-xs">{order.vehicleName || '—'}</td>
                            <td className="py-3 px-4 text-right">{order.weight} kg</td>
                            <td className="py-3 px-4 text-right font-semibold text-green-700">
                              {order.price != null ? format(order.price) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2">
                          <td colSpan={5} className="py-3 px-4 font-bold text-gray-700 text-right">{t('rep.totals')}:</td>
                          <td className="py-3 px-4 text-right font-bold">
                            {orders.reduce((s, o) => s + o.weight, 0).toFixed(1)} kg
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-green-700">
                            {format(orders.reduce((s, o) => s + (o.price || 0), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}

