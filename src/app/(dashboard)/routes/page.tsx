'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Navbar from '@/components/Navbar'
import LocationInput, { LocationValue } from '@/components/LocationInput'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false })

interface RouteOrder {
  id: string
  customerName: string
  operationNumber?: string | null
  address: string
  endAddress?: string | null
  endLat?: number | null
  endLng?: number | null
  lat?: number | null
  lng?: number | null
  status: string
  weight: number
  price?: number | null
  stopOrder?: number | null
  segmentKm?: number | null
}

interface Route {
  id: string
  name?: string | null
  routeCode?: string | null
  status: string
  totalDistance: number
  totalWeight: number
  totalPrice: number
  originAddress?: string | null
  originLat?: number | null
  originLng?: number | null
  orders: RouteOrder[]
  vehicleId?: string | null
  vehicle?: { id: string; name: string; type: string; plate: string | null; capacity: number } | null
  createdAt?: string
}

interface Vehicle {
  id: string
  name: string
  type: string
  plate: string | null
  capacity: number
  status: string
}

interface SavedOrigin {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

interface PendingStop {
  customerName: string
  weight: number
  address: string
  lat: number
  lng: number
}

const emptyLoc: LocationValue = { address: '', lat: null, lng: null }

// ---- Inline pedido (client order) draft form ----
function PedidoForm({
  onAdd,
  markerColor = '#2563eb',
}: {
  onAdd: (stop: PendingStop) => void
  markerColor?: string
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('1')
  const [loc, setLoc] = useState<LocationValue>(emptyLoc)

  const canAdd = name.trim() !== '' && loc.lat != null && loc.lng != null

  const reset = () => {
    setName('')
    setWeight('1')
    setLoc(emptyLoc)
  }

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-gray-50">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('pedido.customer')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder={t('pedido.customerPh')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('pedido.weight')}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
      </div>

      <LocationInput
        value={loc}
        onChange={setLoc}
        label={t('pedido.address')}
        markerColor={markerColor}
      />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            onAdd({
              customerName: name.trim(),
              weight: parseFloat(weight) || 1,
              address: loc.address,
              lat: loc.lat!,
              lng: loc.lng!,
            })
            reset()
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {t('pedido.addThis')}
        </button>
      </div>
    </div>
  )
}

export default function RoutesPage() {
  const { token } = useAppStore()
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [apiError, setApiError] = useState('')

  // Depot (punto de partida)
  const [depot, setDepot] = useState<LocationValue>(emptyLoc)
  const [selectedOriginId, setSelectedOriginId] = useState('')
  const [showSaveOrigin, setShowSaveOrigin] = useState(false)
  const [newOriginName, setNewOriginName] = useState('')

  // Pending client stops to create with the route
  const [pendingStops, setPendingStops] = useState<PendingStop[]>([])
  const [showPedidoForm, setShowPedidoForm] = useState(false)
  // Accordion: which step of the create modal is expanded (1=depot, 2=vehicle, 3=orders)
  const [expandedStep, setExpandedStep] = useState(1)
  const [showStopsModal, setShowStopsModal] = useState(false)
  // Route list filters (apply to both Active and History tabs)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [historyTab, setHistoryTab] = useState<'active' | 'history'>('active')

  const { format } = useCurrency()
  const t = useT()

  const { data: routes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: async () => {
      const res = await axios.get('/api/routes', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Route[]
    },
    enabled: !!token,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const res = await axios.get('/api/vehicles', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Vehicle[]
    },
    enabled: !!token,
  })

  const { data: savedOrigins = [] } = useQuery({
    queryKey: ['origins'],
    queryFn: async () => {
      const res = await axios.get('/api/origins', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as SavedOrigin[]
    },
    enabled: !!token,
  })

  const createRoute = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await axios.post('/api/routes', data, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Route
    },
    onSuccess: (data: Route) => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      resetModal()
      setSelectedRouteId(data.id)
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Error al crear la ruta'
      setApiError(msg || 'Error al crear la ruta')
    },
  })

  const saveOriginMutation = useMutation({
    mutationFn: async (data: { name: string; address: string; lat: number; lng: number }) => {
      const res = await axios.post('/api/origins', data, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as SavedOrigin
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['origins'] })
      setSelectedOriginId(data.id)
      setShowSaveOrigin(false)
      setNewOriginName('')
    },
  })

  const deleteOriginMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/origins/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['origins'] })
      setSelectedOriginId('')
      setDepot(emptyLoc)
    },
  })

  const completeRoute = useMutation({
    mutationFn: async (routeId: string) => {
      const res = await axios.patch(`/api/routes/${routeId}`, { status: 'completed' }, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      setSelectedRouteId(null)
      setHistoryTab('history')
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Error al completar la ruta'
      setApiError(msg || 'Error al completar la ruta')
    },
  })

  const deleteRoute = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/routes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      setSelectedRouteId(null)
    },
  })

  const resetModal = () => {
    setShowModal(false)
    setRouteName('')
    setSelectedVehicleId('')
    setDepot(emptyLoc)
    setSelectedOriginId('')
    setShowSaveOrigin(false)
    setNewOriginName('')
    setPendingStops([])
    setShowPedidoForm(false)
    setExpandedStep(1)
    setApiError('')
  }

  const handleSelectSavedOrigin = (originId: string) => {
    setSelectedOriginId(originId)
    if (!originId) {
      setDepot(emptyLoc)
      return
    }
    const found = (savedOrigins as SavedOrigin[]).find((o) => o.id === originId)
    if (found) {
      setDepot({ address: found.address, lat: found.lat, lng: found.lng })
    }
  }

  const depotSet = depot.lat != null && depot.lng != null
  const pendingWeight = pendingStops.reduce((s, p) => s + p.weight, 0)
  const selectedVehicle = (vehicles as Vehicle[]).find((v) => v.id === selectedVehicleId)
  const pendingOverCapacity = selectedVehicle != null && pendingWeight > selectedVehicle.capacity

  const handleCreateRoute = () => {
    if (!depotSet || !selectedVehicleId || pendingStops.length === 0) return
    if (pendingOverCapacity) {
      setApiError(`Peso total (${pendingWeight.toFixed(1)} kg) supera la capacidad del vehículo (${selectedVehicle!.capacity} kg)`)
      return
    }
    setApiError('')
    createRoute.mutate({
      name: routeName || undefined,
      vehicleId: selectedVehicleId || undefined,
      originAddress: depot.address || undefined,
      originLat: depot.lat,
      originLng: depot.lng,
      stops: pendingStops,
    })
  }

  const selectedRoute = (routes as Route[]).find((r) => r.id === selectedRouteId) ?? null
  const activeRoutes = (routes as Route[]).filter((r) => r.status !== 'completed')
  const historyRoutes = (routes as Route[]).filter((r) => r.status === 'completed')
  const tabRoutes = historyTab === 'active' ? activeRoutes : historyRoutes
  const q = search.trim().toLowerCase()
  const visibleRoutes = tabRoutes.filter((r) => {
    const matchName = !q
      || (r.routeCode || '').toLowerCase().includes(q)
      || (r.name || '').toLowerCase().includes(q)
      || (r.originAddress || '').toLowerCase().includes(q)
      || (r.vehicle?.name || '').toLowerCase().includes(q)
    const created = r.createdAt ? new Date(r.createdAt) : null
    const matchFrom = !dateFrom || (created != null && created >= new Date(dateFrom))
    const matchTo = !dateTo || (created != null && created <= new Date(dateTo + 'T23:59:59.999'))
    return matchName && matchFrom && matchTo
  })

  const mapStops: Array<{
    id: string
    lat: number
    lng: number
    label: string
    priceLabel?: string
    status?: string
    tripLeg?: 'outbound' | 'return'
    isOrigin?: boolean
  }> = []

  if (selectedRoute) {
    if (selectedRoute.originLat && selectedRoute.originLng) {
      mapStops.push({
        id: 'origin',
        lat: selectedRoute.originLat,
        lng: selectedRoute.originLng,
        label: selectedRoute.originAddress || 'Punto de partida',
        isOrigin: true,
      })
    }
    selectedRoute.orders
      .slice()
      .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
      .forEach((o) => {
        const lat = o.endLat ?? o.lat
        const lng = o.endLng ?? o.lng
        if (lat && lng) {
          mapStops.push({
            id: o.id,
            lat,
            lng,
            label: `${o.customerName} · ${o.endAddress || o.address}`,
            priceLabel: o.price != null ? format(o.price) : undefined,
            status: o.status,
            tripLeg: 'outbound',
          })
        }
      })
  }

  const orderedStops = selectedRoute?.orders
    .slice()
    .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0)) ?? []

  const isOverCapacity = (route: Route) =>
    route.vehicle != null && route.totalWeight > route.vehicle.capacity

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      in_transit: 'bg-blue-100 text-blue-700',
      delivered: 'bg-green-100 text-green-700',
      active: 'bg-blue-100 text-blue-700',
      planned: 'bg-yellow-100 text-yellow-700',
      completed: 'bg-green-100 text-green-700',
    }
    return map[status] ?? 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar title={t('routes.title')} />
      <div className="p-6 flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-700">{t('routes.planner')}</h3>
            <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
              <button
                onClick={() => { setHistoryTab('active'); setSelectedRouteId(null) }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${historyTab === 'active' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('routes.active')} <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{activeRoutes.length}</span>
              </button>
              <button
                onClick={() => { setHistoryTab('history'); setSelectedRouteId(null) }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${historyTab === 'history' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('routes.history')} <span className="ml-1 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{historyRoutes.length}</span>
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-primary text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            {t('routes.new')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0 overflow-hidden">
          {/* Left: filters (fixed) + route list (internal scroll) */}
          <div className="lg:col-span-1 min-h-0 flex flex-col gap-3">
            <div className="shrink-0 space-y-2">
              <div className="relative">
                <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('routes.searchPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title={t('common.from')}
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title={t('common.to')}
                />
                {(search || dateFrom || dateTo) && (
                  <button
                    onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
                    className="px-2 text-gray-400 hover:text-gray-600"
                    title={t('common.clear')}
                  >
                    <Icon icon="mdi:close" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3 overflow-y-auto min-h-0 pr-1">
            {visibleRoutes.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center text-gray-500 shadow-md">
                {historyTab === 'active' ? t('routes.noActive') : t('routes.noCompleted')}
              </div>
            ) : (
              visibleRoutes.map((route) => (
                <div
                  key={route.id}
                  className={`bg-white rounded-2xl shadow-md p-4 cursor-pointer border-2 transition-colors ${
                    selectedRouteId === route.id ? 'border-primary' : 'border-transparent hover:border-blue-200'
                  }`}
                  onClick={() => {
                    setSelectedRouteId(route.id)
                    setShowStopsModal(false)
                    setApiError('')
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {route.routeCode && (
                        <span className="inline-block font-mono text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-lg mb-1 tracking-wide">
                          {route.routeCode}
                        </span>
                      )}
                      {route.name && (
                        <p className="font-medium text-gray-800 text-sm truncate">{route.name}</p>
                      )}
                      {!route.routeCode && !route.name && (
                        <p className="font-semibold text-gray-800 truncate">{t('routes.noCode')}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('routes.stopsKm', { n: route.orders.length, km: route.totalDistance.toFixed(1) })}
                      </p>
                      {route.vehicle && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          <Icon icon="mdi:truck-outline" className="inline align-text-bottom mr-1" />{route.vehicle.name}{route.vehicle.plate ? ` (${route.vehicle.plate})` : ''}
                        </p>
                      )}
                      {route.originAddress && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate"><Icon icon="mdi:map-marker-outline" className="inline align-text-bottom mr-1" />{route.originAddress}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusBadge(route.status)}`}>
                        {route.status}
                      </span>
                      {isOverCapacity(route) && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          <Icon icon="mdi:alert-outline" className="inline align-text-bottom mr-0.5" />{t('routes.overweight')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <span className="text-sm font-bold text-primary">{format(route.totalPrice)}</span>
                    </div>
                    {route.status !== 'completed' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteRoute.mutate(route.id) }}
                        className="text-xs text-red-500 hover:underline"
                        disabled={deleteRoute.isPending}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            </div>
          </div>

          {/* Right: selected route detail (fills height, no page scroll) */}
          <div className="lg:col-span-2 min-h-0 flex flex-col">
            {selectedRoute ? (
              <>
                <div className="bg-white rounded-2xl shadow-md p-4 flex-1 flex flex-col min-h-0">
                  <div className="flex items-start justify-between mb-2 shrink-0 gap-2">
                    <div className="min-w-0">
                      {selectedRoute.routeCode && (
                        <span className="inline-block font-mono text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-lg mb-1 tracking-wide">
                          {selectedRoute.routeCode}
                        </span>
                      )}
                      <h3 className="font-bold text-gray-800 truncate">
                        {selectedRoute.name || selectedRoute.routeCode || 'Ruta'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      {orderedStops.length > 0 && (
                        <div className="relative">
                          <button
                            onClick={() => setShowStopsModal((v) => !v)}
                            className="text-xs px-3 py-1.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <Icon icon="mdi:format-list-numbered" />{t('routes.viewStops', { n: orderedStops.length })}
                          </button>
                          {showStopsModal && (
                            <>
                              <div className="fixed inset-0 z-20" onClick={() => setShowStopsModal(false)} />
                              <div className="absolute right-0 top-full mt-2 w-80 max-h-[60vh] overflow-y-auto bg-white rounded-xl shadow-xl border z-30 p-2 space-y-2">
                                <p className="text-xs font-semibold text-gray-500 px-1 pt-1">{t('routes.stopsAndPrice', { n: orderedStops.length })}</p>
                                {orderedStops.map((order, idx) => (
                                  <div key={order.id} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                                    <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">{idx + 1}</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium truncate">{order.customerName}</p>
                                      <p className="text-[11px] text-gray-500 truncate">{order.endAddress || order.address}</p>
                                      <p className="text-[11px] text-gray-400">{order.weight} kg{order.segmentKm != null ? ` · ${t('routes.kmFromStart', { km: order.segmentKm.toFixed(1) })}` : ''}</p>
                                    </div>
                                    {order.price != null && (
                                      <p className="text-xs font-semibold text-blue-700 shrink-0">{format(order.price)}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {selectedRoute.status !== 'completed' && (
                        <button
                          onClick={() => completeRoute.mutate(selectedRoute.id)}
                          disabled={completeRoute.isPending}
                          className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1"
                        >
                          <Icon icon="mdi:check-circle-outline" />{completeRoute.isPending ? t('routes.completing') : t('routes.markComplete')}
                        </button>
                      )}
                      {isOverCapacity(selectedRoute) && (
                        <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                          <Icon icon="mdi:alert-outline" />{t('routes.overweightFull', { w: selectedRoute.totalWeight.toFixed(1), c: selectedRoute.vehicle!.capacity })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3 shrink-0">
                    <span className="flex items-center gap-1"><Icon icon="mdi:road-variant" />{t('routes.kmInclReturn', { km: selectedRoute.totalDistance.toFixed(1) })}</span>
                    <span className="flex items-center gap-1"><Icon icon="mdi:weight" />{selectedRoute.totalWeight.toFixed(1)} kg</span>
                    <span className="font-semibold text-primary flex items-center gap-1"><Icon icon="mdi:cash" />{format(selectedRoute.totalPrice)}</span>
                    {selectedRoute.vehicle && (
                      <span className="flex items-center gap-1"><Icon icon="mdi:truck-outline" />{selectedRoute.vehicle.name}{selectedRoute.vehicle.plate ? ` · ${selectedRoute.vehicle.plate}` : ''}</span>
                    )}
                  </div>
                  <div className="flex-1 min-h-0">
                    {mapStops.length > 0 ? (
                      <MapComponent stops={mapStops} height="100%" />
                    ) : (
                      <div className="h-full min-h-[240px] bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 text-sm">
                        {t('routes.noGps')}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500 shrink-0">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-green-600 inline-block" /> {t('routes.legendStart')}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> {t('routes.legendStops')}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-1 bg-orange-500 inline-block" /> {t('routes.legendReturn')}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-2xl shadow-md p-12 text-center text-gray-500">
                {t('routes.selectToView')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Route Modal — stepped flow */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetModal() }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-5">{t('routes.modalTitle')}</h3>
            <div className="space-y-6">

              {apiError && (
                <div className="bg-red-50 text-red-600 px-3 py-2 rounded-xl text-sm">{apiError}</div>
              )}

              {/* Step 1 — depot (accordion) */}
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedStep(1)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50"
                >
                  <span className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step1')}</h4>
                  {expandedStep !== 1 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">
                        {depotSet ? (depot.address || `${depot.lat!.toFixed(4)}, ${depot.lng!.toFixed(4)}`) : t('routes.notSet')}
                      </span>
                      <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>
                    </span>
                  )}
                </button>
                {expandedStep === 1 && (
                  <div className="p-3 border-t space-y-2">
                    {(savedOrigins as SavedOrigin[]).length > 0 && (
                      <div className="mb-2">
                        <select
                          value={selectedOriginId}
                          onChange={(e) => handleSelectSavedOrigin(e.target.value)}
                          className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          <option value="">{t('routes.selectSavedOrigin')}</option>
                          {(savedOrigins as SavedOrigin[]).map((o) => (
                            <option key={o.id} value={o.id}>{o.name} · {o.address}</option>
                          ))}
                        </select>
                        {selectedOriginId && (
                          <div className="flex justify-end mt-1">
                            <button
                              type="button"
                              onClick={() => deleteOriginMutation.mutate(selectedOriginId)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              {t('routes.deleteSaved')}
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-1 mb-2">{t('routes.orEnterNew')}</p>
                      </div>
                    )}

                    <LocationInput
                      value={depot}
                      onChange={(v) => { setDepot(v); setSelectedOriginId('') }}
                      label=""
                      markerColor="#16a34a"
                      placeholder={t('routes.depotPlaceholder')}
                    />

                    {depotSet && !selectedOriginId && (
                      <div className="mt-1">
                        {!showSaveOrigin ? (
                          <button type="button" onClick={() => setShowSaveOrigin(true)} className="text-xs text-blue-600 hover:underline">
                            {t('routes.saveOrigin')}
                          </button>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={newOriginName}
                              onChange={(e) => setNewOriginName(e.target.value)}
                              className="flex-1 px-3 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={t('routes.originNamePh')}
                            />
                            <button
                              type="button"
                              disabled={!newOriginName.trim() || saveOriginMutation.isPending}
                              onClick={() => {
                                if (newOriginName.trim() && depot.lat != null && depot.lng != null) {
                                  saveOriginMutation.mutate({ name: newOriginName.trim(), address: depot.address, lat: depot.lat, lng: depot.lng })
                                }
                              }}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              {saveOriginMutation.isPending ? '...' : t('common.save')}
                            </button>
                            <button type="button" onClick={() => { setShowSaveOrigin(false); setNewOriginName('') }} className="text-gray-400 hover:text-gray-600"><Icon icon="mdi:close" /></button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={!depotSet}
                        onClick={() => setExpandedStep(2)}
                        className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        {t('routes.continue')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2 — vehicle (required) + name (accordion) */}
              <div className={`border rounded-xl overflow-hidden ${!depotSet ? 'opacity-50' : ''}`}>
                <button
                  type="button"
                  disabled={!depotSet}
                  onClick={() => depotSet && setExpandedStep(2)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step2Vehicle')}</h4>
                  {expandedStep !== 2 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">
                        {selectedVehicle ? `${selectedVehicle.name}${selectedVehicle.plate ? ` (${selectedVehicle.plate})` : ''}${routeName ? ` · ${routeName}` : ''}` : t('routes.notSet')}
                      </span>
                      {depotSet && <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>}
                    </span>
                  )}
                </button>
                {expandedStep === 2 && (
                  <div className="p-3 border-t space-y-3">
                    {(vehicles as Vehicle[]).filter((v) => v.status === 'available').length === 0 ? (
                      <div className="bg-amber-50 text-amber-700 px-3 py-2 rounded-xl text-sm">
                        {t('routes.noVehiclesAvail')}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <select
                            value={selectedVehicleId}
                            onChange={(e) => setSelectedVehicleId(e.target.value)}
                            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          >
                            <option value="">{t('routes.selectVehicle')}</option>
                            {(vehicles as Vehicle[]).filter((v) => v.status === 'available').map((v) => (
                              <option key={v.id} value={v.id}>{v.name}{v.plate ? ` (${v.plate})` : ''} · {t('routes.capacity', { c: v.capacity })}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={routeName}
                            onChange={(e) => setRouteName(e.target.value)}
                            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            placeholder={t('routes.namePlaceholder')}
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={!selectedVehicleId}
                            onClick={() => setExpandedStep(3)}
                            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {t('routes.continue')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3 — client orders (accordion) */}
              <div className={`border rounded-xl overflow-hidden ${!(depotSet && selectedVehicleId) ? 'opacity-50' : ''}`}>
                <button
                  type="button"
                  disabled={!(depotSet && selectedVehicleId)}
                  onClick={() => depotSet && selectedVehicleId && setExpandedStep(3)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step3Orders', { n: pendingStops.length })}</h4>
                  {expandedStep !== 3 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">{t('routes.ordersSummary', { n: pendingStops.length })}</span>
                      {depotSet && selectedVehicleId && <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>}
                    </span>
                  )}
                </button>
                {expandedStep === 3 && (
                  <div className="p-3 border-t">
                    {pendingStops.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {pendingStops.map((s, i) => (
                          <div key={i} className="flex items-center gap-3 p-2.5 border rounded-xl bg-white">
                            <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{s.customerName}</p>
                              <p className="text-xs text-gray-500 truncate">{s.address}</p>
                            </div>
                            <span className="text-xs text-gray-500 shrink-0">{s.weight} kg</span>
                            <button onClick={() => setPendingStops(pendingStops.filter((_, idx) => idx !== i))} className="text-xs text-red-400 hover:text-red-600 shrink-0">{t('common.remove')}</button>
                          </div>
                        ))}
                        {pendingOverCapacity && (
                          <p className="text-xs text-amber-600 font-medium flex items-center gap-1"><Icon icon="mdi:alert-outline" />{t('routes.overCapWarn', { w: pendingWeight.toFixed(1), c: selectedVehicle!.capacity })}</p>
                        )}
                      </div>
                    )}

                    {showPedidoForm ? (
                      <PedidoForm onAdd={(stop) => { setPendingStops((prev) => [...prev, stop]); setShowPedidoForm(false) }} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowPedidoForm(true)}
                        className="w-full py-2.5 border-2 border-dashed border-blue-300 text-blue-600 rounded-xl text-sm font-medium hover:bg-blue-50"
                      >
                        {t('routes.addOrder')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button onClick={resetModal} className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
                <button
                  onClick={handleCreateRoute}
                  disabled={!depotSet || !selectedVehicleId || pendingStops.length === 0 || pendingOverCapacity || createRoute.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <Icon icon="mdi:map-marker-path" />{createRoute.isPending ? t('routes.generating') : t('routes.generate')}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
