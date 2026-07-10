'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false })
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
  packs?: number | null
}

interface OrderRow {
  id: string
  operationNumber?: string | null
  customerName: string
  customerPhone?: string | null
  address: string
  endAddress?: string | null
  endLat?: number | null
  endLng?: number | null
  weight: number
  price?: number | null
  deliveryDistanceKm?: number | null
  municipio?: string | null
  items?: OrderItem[]
  createdAt: string
  status?: string | null
  deliveredAt?: string | null
  routeId?: string | null
  branch?: { id: string; name: string; lat: number; lng: number } | null
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
  const { token, sucursalId } = useAppStore()
  const { format } = useCurrency()
  const t = useT()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recientes')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [municipioFilter, setMunicipioFilter] = useState('todos')
  const [detail, setDetail] = useState<OrderRow | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Bloquear el scroll del fondo mientras el modal está abierto (solo el modal se usa).
  useEffect(() => {
    if (!detail) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [detail])

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const res = await axios.get('/api/orders', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as OrderRow[]
    },
    enabled: !!token,
  })

  // Estado de entrega del pedido (para el badge y el filtro):
  //  - Entregado: ya se entregó (deliveredAt) o su ruta está completada.
  //  - En reparto: está en una ruta (asignado, saliendo) pero aún no entregado.
  //  - Pendiente: todavía no está en ninguna ruta.
  const deliveryStatus = (o: OrderRow) => {
    if (o.deliveredAt || o.route?.status === 'completed') return { key: 'entregado', label: 'Entregado', cls: 'bg-green-100 text-green-700' }
    if (o.routeId || o.route?.id) return { key: 'reparto', label: 'En reparto', cls: 'bg-blue-100 text-blue-700' }
    return { key: 'pendiente', label: 'Pendiente', cls: 'bg-gray-100 text-gray-600' }
  }

  // Municipios distintos (no vacíos) presentes en los pedidos, ordenados.
  const municipios = Array.from(
    new Set(
      orders
        .map((o) => (o.municipio || '').trim())
        .filter((m) => m !== '')
    )
  ).sort((a, b) => a.localeCompare(b))

  const q = search.trim().toLowerCase()
  const filtered = orders
    .filter((o) => !sucursalId || o.branch?.id === sucursalId)
    .filter((o) =>
      !q
      || o.customerName.toLowerCase().includes(q)
      || (o.route?.routeCode || '').toLowerCase().includes(q)
      || (o.route?.vehicle?.name || '').toLowerCase().includes(q)
      || (o.endAddress || o.address || '').toLowerCase().includes(q)
    )
    .filter((o) => statusFilter === 'todos' || deliveryStatus(o).key === statusFilter)
    .filter((o) => municipioFilter === 'todos' || o.municipio === municipioFilter)

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'precio_desc': return (b.price ?? 0) - (a.price ?? 0)
      case 'precio_asc': return (a.price ?? 0) - (b.price ?? 0)
      case 'distancia_desc': return (b.deliveryDistanceKm ?? 0) - (a.deliveryDistanceKm ?? 0)
      case 'peso_desc': return (b.weight ?? 0) - (a.weight ?? 0)
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
  })

  const paged = usePagedList(sorted, 25)

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—'
  const itemLabel = (it: OrderItem) => it.name || it.description || '—'

  return (
    <div className="flex flex-col">
      <Navbar title={t('ord.title')} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-700">{t('ord.title')}</h3>
            <p className="text-sm text-gray-500">{t('ord.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-500">{t('ord.totalOrders', { n: sorted.length })}</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="py-2 px-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="reparto">En reparto</option>
              <option value="entregado">Entregado</option>
            </select>
            <select
              value={municipioFilter}
              onChange={(e) => setMunicipioFilter(e.target.value)}
              className="py-2 px-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos los municipios</option>
              {municipios.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="py-2 px-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="recientes">Más recientes</option>
              <option value="precio_desc">Precio: mayor a menor</option>
              <option value="precio_asc">Precio: menor a mayor</option>
              <option value="distancia_desc">Distancia: más larga</option>
              <option value="peso_desc">Peso: mayor</option>
            </select>
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
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b hover:bg-blue-50/40 align-middle cursor-pointer"
                    onClick={() => setDetail(o)}
                  >
                    <td className="px-4 py-3 font-medium">{o.customerName}</td>
                    <td className="px-4 py-3">
                      {o.route?.routeCode ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">{o.route.routeCode}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{o.route?.vehicle?.name || '—'}</td>
                    <td className="px-4 py-3">
                      {o.items && o.items.length > 0 ? (
                        <div className="relative group inline-flex items-center gap-1">
                          <span className="text-[11px] bg-gray-100 rounded-full px-2 py-0.5 truncate max-w-[150px]">
                            {itemLabel(o.items[0])} <b>×{o.items[0].quantity}</b>
                          </span>
                          {o.items.length > 1 && (
                            <span className="text-[11px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 whitespace-nowrap font-medium">
                              +{o.items.length - 1}
                            </span>
                          )}
                          {o.items.length > 1 && (
                            <div className="hidden group-hover:block absolute left-0 top-full mt-1 z-20 bg-white border shadow-xl rounded-xl p-2 w-64 max-h-64 overflow-y-auto space-y-1">
                              {o.items.map((it, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="truncate text-gray-700">{itemLabel(it)}</span>
                                  <b className="shrink-0 text-gray-900">×{it.quantity}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-gray-300 text-xs italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate">{o.endAddress || o.address}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{o.weight?.toFixed(1)} kg</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700 font-mono">{o.price != null ? format(o.price) : '—'}</td>
                    <td className="px-4 py-3">
                      {(() => { const s = deliveryStatus(o); return (
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
                      )})()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300"><Icon icon="mdi:chevron-right" /></td>
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

      {/* Detalle del pedido — por portal a document.body para escapar el `transform` del
          layout (animate-rise) que rompería `position: fixed`. */}
      {detail && mounted && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-3 p-5 border-b sticky top-0 bg-white">
              <div>
                <h3 className="text-lg font-bold text-gray-800">{detail.customerName}</h3>
                {detail.operationNumber && (
                  <p className="text-xs text-gray-400 font-mono">{detail.operationNumber}</p>
                )}
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700">
                <Icon icon="mdi:close" className="text-xl" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Entrega */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Entrega</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <Icon icon="mdi:map-marker" className="text-blue-500 mt-0.5 shrink-0" />
                    <span className="text-gray-700">{detail.endAddress || detail.address}</span>
                  </div>
                  {detail.endLat != null && detail.endLng != null && (
                    <div className="flex gap-2 items-center">
                      <Icon icon="mdi:crosshairs-gps" className="text-gray-400 shrink-0" />
                      <span className="text-gray-500 font-mono text-xs">{detail.endLat.toFixed(6)}, {detail.endLng.toFixed(6)}</span>
                      <a
                        href={`https://www.google.com/maps?q=${detail.endLat},${detail.endLng}`}
                        target="_blank" rel="noreferrer"
                        className="text-blue-600 text-xs hover:underline"
                      >
                        ver mapa
                      </a>
                    </div>
                  )}
                  {detail.customerPhone && (
                    <div className="flex gap-2 items-center">
                      <Icon icon="mdi:phone" className="text-gray-400 shrink-0" />
                      <span className="text-gray-600 text-xs">{detail.customerPhone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Recorrido: almacén (punto de partida) → cliente */}
              {detail.branch && detail.endLat != null && detail.endLng != null && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recorrido</p>
                  <div className="rounded-xl overflow-hidden border">
                    <MapComponent
                      height="220px"
                      stops={[
                        { id: 'origin', lat: detail.branch.lat, lng: detail.branch.lng, label: detail.branch.name || 'Almacén', isOrigin: true },
                        { id: detail.id, lat: detail.endLat, lng: detail.endLng, label: detail.customerName, tripLeg: 'outbound' },
                      ]}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Del almacén ({detail.branch.name}) al cliente.</p>
                </div>
              )}

              {/* Costo del domicilio — por qué salió ese valor */}
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Costo del domicilio</p>
                <div className="flex items-end justify-between">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <span className="text-gray-500">Distancia</span>
                    <span className="font-mono text-gray-800">{detail.deliveryDistanceKm != null ? `${detail.deliveryDistanceKm.toFixed(2)} km` : '—'}</span>
                    <span className="text-gray-500">Peso total</span>
                    <span className="font-mono text-gray-800">{detail.weight?.toFixed(2)} kg</span>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-700 font-mono">{detail.price != null ? format(detail.price) : '—'}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">La distancia es del almacén al cliente (ida y vuelta ×2).</p>
              </div>

              {/* Productos */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Productos {detail.items?.length ? `(${detail.items.length})` : ''}
                </p>
                {detail.items && detail.items.length > 0 ? (
                  <div className="space-y-1">
                    {detail.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-800 truncate">{itemLabel(it)}</p>
                          {it.packs != null && <p className="text-[11px] text-gray-400">{it.packs} pack(s)</p>}
                        </div>
                        <b className="shrink-0 text-gray-900">×{it.quantity}</b>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400 italic">Sin productos</p>}
              </div>

              {/* Ruta */}
              {detail.route?.routeCode && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Ruta</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">{detail.route.routeCode}</span>
                    {detail.route.vehicle?.name && <span className="text-gray-600">{detail.route.vehicle.name}</span>}
                    <span className="text-gray-400 text-xs ml-auto">{fmtDate(detail.route.deliveryDate)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
