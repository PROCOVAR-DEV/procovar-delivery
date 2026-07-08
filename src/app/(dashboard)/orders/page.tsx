'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface OrderItem {
  name?: string
  description?: string
  packaging?: string | null
  quantity: number
}

interface OrderRow {
  id: string
  customerName: string
  address: string
  endAddress?: string | null
  weight: number
  price?: number | null
  items?: OrderItem[]
  createdAt: string
  route?: {
    id: string
    name?: string | null
    routeCode?: string | null
    status?: string | null
    deliveryDate?: string | null
    vehicle?: { name: string; plate: string | null } | null
  } | null
}

export default function OrdersPage() {
  const { token } = useAppStore()
  const { format } = useCurrency()
  const t = useT()
  const [search, setSearch] = useState('')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const res = await axios.get('/api/orders', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as OrderRow[]
    },
    enabled: !!token,
  })

  const q = search.trim().toLowerCase()
  const filtered = orders.filter((o) =>
    !q
    || o.customerName.toLowerCase().includes(q)
    || (o.route?.routeCode || '').toLowerCase().includes(q)
    || (o.route?.vehicle?.name || '').toLowerCase().includes(q)
    || (o.endAddress || o.address || '').toLowerCase().includes(q)
  )

  const paged = usePagedList(filtered, 25)

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—'

  return (
    <div className="flex flex-col">
      <Navbar title={t('ord.title')} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-700">{t('ord.title')}</h3>
            <p className="text-sm text-gray-500">{t('ord.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{t('ord.totalOrders', { n: filtered.length })}</span>
            <div className="relative">
              <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('common.search')}
                className="pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-md overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-500">{t('ord.empty')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">{t('ord.colClient')}</th>
                  <th className="px-4 py-3 font-semibold">{t('ord.colRoute')}</th>
                  <th className="px-4 py-3 font-semibold">{t('ord.colVehicle')}</th>
                  <th className="px-4 py-3 font-semibold">{t('ord.colItems')}</th>
                  <th className="px-4 py-3 font-semibold">{t('ord.colAddress')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('common.weight')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('common.price')}</th>
                  <th className="px-4 py-3 font-semibold">{t('ord.colDelivery')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((o) => (
                  <tr key={o.id} className="border-b hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-medium">{o.customerName}</td>
                    <td className="px-4 py-3">
                      {o.route?.routeCode ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">{o.route.routeCode}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{o.route?.vehicle?.name || '—'}</td>
                    <td className="px-4 py-3">
                      {o.items && o.items.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {o.items.map((it, i) => (
                            <span key={i} className="text-[11px] bg-gray-100 rounded-full px-2 py-0.5">{it.name || it.description} <b>×{it.quantity}</b></span>
                          ))}
                        </div>
                      ) : <span className="text-gray-300 text-xs italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate">{o.endAddress || o.address}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{o.weight} kg</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700 font-mono">{o.price != null ? format(o.price) : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{fmtDate(o.route?.deliveryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!isLoading && filtered.length > 0 && (
            <Pagination
              page={paged.page}
              totalPages={paged.totalPages}
              total={paged.total}
              from={paged.from}
              to={paged.to}
              pageSize={paged.pageSize}
              onPage={paged.setPage}
              onPageSize={paged.setPageSize}
            />
          )}
        </div>
      </div>
    </div>
  )
}
