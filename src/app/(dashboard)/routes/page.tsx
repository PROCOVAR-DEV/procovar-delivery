'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Navbar from '@/components/Navbar'
import LocationInput, { LocationValue } from '@/components/LocationInput'
import ProductPicker from '@/components/ProductPicker'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false })

interface OrderItem {
  productId?: string
  name: string
  weight?: number
  packaging?: string | null
  category?: string | null
  quantity: number
  description?: string // legacy free-text items
}

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
  items?: OrderItem[]
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
  deliveryDate?: string | null
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

interface AvailableOrder {
  id: string
  operationNumber?: string | null
  customerName: string
  address: string
  endAddress?: string | null
  endLat?: number | null
  endLng?: number | null
  weight: number
  deliveryPrice?: number | null
  deliveryDistanceKm?: number | null
  items?: OrderItem[]
}

interface PendingStop {
  customerName: string
  weight: number
  address: string
  lat: number
  lng: number
  items: OrderItem[]
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
  const [manualWeight, setManualWeight] = useState('1')
  const [loc, setLoc] = useState<LocationValue>(emptyLoc)
  const [items, setItems] = useState<OrderItem[]>([])

  const computedWeight = items.reduce((s, it) => s + (it.weight || 0) * it.quantity, 0)
  const effectiveWeight = items.length > 0 ? computedWeight : (parseFloat(manualWeight) || 0)
  const canAdd = name.trim() !== '' && loc.lat != null && loc.lng != null

  const reset = () => {
    setName('')
    setManualWeight('1')
    setLoc(emptyLoc)
    setItems([])
  }

  const addProduct = (p: { id: string; name: string; weight: number; packaging?: string | null; category?: string | null }) => {
    setItems((prev) => {
      const existing = prev.find((x) => x.productId === p.id)
      if (existing) return prev.map((x) => x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x)
      return [...prev, { productId: p.id, name: p.name, weight: p.weight, packaging: p.packaging, category: p.category, quantity: 1 }]
    })
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {items.length > 0 ? t('prod.autoWeight') : t('pedido.weight')}
          </label>
          {items.length > 0 ? (
            <div className="w-full px-3 py-2 border rounded-xl text-sm bg-gray-100 text-gray-700 font-mono">{computedWeight.toFixed(2)} kg</div>
          ) : (
            <input
              type="number" step="0.1" min="0"
              value={manualWeight}
              onChange={(e) => setManualWeight(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          )}
        </div>
      </div>

      <LocationInput
        value={loc}
        onChange={setLoc}
        label={t('pedido.address')}
        markerColor={markerColor}
      />

      {/* Product breakdown — search the catalog; weight auto-sums */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('routes.items')}</label>
        {items.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-white border rounded-xl px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{it.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {it.packaging ? `${it.packaging} · ` : ''}{((it.weight || 0) * it.quantity).toFixed(2)} kg
                  </p>
                </div>
                <input
                  type="number" min="1"
                  value={it.quantity}
                  onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, quantity: parseInt(e.target.value) || 1 } : x))}
                  className="w-16 px-2 py-1 border rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                  <Icon icon="mdi:close" />
                </button>
              </div>
            ))}
          </div>
        )}
        <ProductPicker onPick={addProduct} />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            onAdd({
              customerName: name.trim(),
              weight: effectiveWeight || 1,
              address: loc.address,
              lat: loc.lat!,
              lng: loc.lng!,
              items: items.map((it) => ({
                productId: it.productId,
                name: it.name,
                weight: it.weight,
                packaging: it.packaging,
                category: it.category,
                quantity: it.quantity || 1,
              })),
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
  const { token, user } = useAppStore()
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [apiError, setApiError] = useState('')

  // Depot (punto de partida)
  const [depot, setDepot] = useState<LocationValue>(emptyLoc)
  const [selectedOriginId, setSelectedOriginId] = useState('')
  const [showSaveOrigin, setShowSaveOrigin] = useState(false)
  const [newOriginName, setNewOriginName] = useState('')

  // Existing available orders to pick for the route
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())

  // Pending client stops to create with the route (manual flow)
  const [pendingStops, setPendingStops] = useState<PendingStop[]>([])
  const [showPedidoForm, setShowPedidoForm] = useState(false)
  // Accordion: which step of the create modal is expanded (1=depot, 2=vehicle, 3=orders)
  const [expandedStep, setExpandedStep] = useState(1)
  const [showStopsModal, setShowStopsModal] = useState(false)
  // Route list filters (apply to both Active and History tabs)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [historyTab, setHistoryTab] = useState<'active' | 'in_progress' | 'history'>('active')

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
    queryKey: ['origins', user?.branchId ?? 'all'],
    queryFn: async () => {
      const url = user?.branchId ? `/api/origins?branchId=${user.branchId}` : '/api/origins'
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as SavedOrigin[]
    },
    enabled: !!token,
  })

  const { data: availableOrders = [], isLoading: loadingAvailable } = useQuery({
    queryKey: ['orders-available', orderSearch],
    queryFn: async () => {
      const res = await axios.get('/api/orders/available', {
        params: { q: orderSearch },
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data as AvailableOrder[]
    },
    enabled: !!token,
  })

  // When the create modal opens and no depot is set yet, default to the first
  // saved origin (the branch's start point) so the user needn't locate it manually.
  useEffect(() => {
    if (!showModal) return
    if (depot.lat != null && depot.lng != null) return
    const origins = savedOrigins as SavedOrigin[]
    if (origins.length === 0) return
    const first = origins[0]
    setDepot({ address: first.address, lat: first.lat, lng: first.lng })
    setSelectedOriginId(first.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, savedOrigins])

  const createRoute = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await axios.post('/api/routes', data, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Route
    },
    onSuccess: (data: Route) => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['orders-available'] })
      resetModal()
      setSelectedRouteId(data.id)
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Error al crear la ruta'
      setApiError(msg || 'Error al crear la ruta')
    },
  })

  const saveOriginMutation = useMutation({
    mutationFn: async (data: { name: string; address: string; lat: number; lng: number; branchId?: string }) => {
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

  const startRoute = useMutation({
    mutationFn: async (routeId: string) => {
      const res = await axios.patch(`/api/routes/${routeId}`, { status: 'in_progress' }, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      setHistoryTab('in_progress')
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Error al iniciar la ruta'
      setApiError(msg || 'Error al iniciar la ruta')
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
    setDeliveryDate('')
    setDepot(emptyLoc)
    setSelectedOriginId('')
    setShowSaveOrigin(false)
    setNewOriginName('')
    setPendingStops([])
    setShowPedidoForm(false)
    setExpandedStep(1)
    setApiError('')
    setSelectedOrderIds(new Set())
    setOrderSearch('')
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

  // Selected existing orders (primary flow)
  const selectedOrders = (availableOrders as AvailableOrder[]).filter((o) => selectedOrderIds.has(o.id))
  const selectedWeight = selectedOrders.reduce((s, o) => s + (o.weight || 0), 0)
  const selectedOverCapacity = selectedVehicle != null && selectedWeight > selectedVehicle.capacity
  const hasSelectedOrders = selectedOrderIds.size > 0

  // Capacidad del camión seleccionado (para la barra "LLENO / no cabe más").
  const capacity = selectedVehicle?.capacity ?? 0
  const capacityPct = capacity > 0 ? (selectedWeight / capacity) * 100 : 0
  const isFull = selectedVehicle != null && selectedWeight >= capacity
  const capacityBarColor = capacityPct >= 100 ? 'bg-red-500' : capacityPct >= 80 ? 'bg-amber-500' : 'bg-green-500'

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateRoute = () => {
    if (!depotSet || !selectedVehicleId || (!hasSelectedOrders && pendingStops.length === 0)) return
    const overCap = hasSelectedOrders ? selectedOverCapacity : pendingOverCapacity
    if (overCap) {
      const w = hasSelectedOrders ? selectedWeight : pendingWeight
      setApiError(t('routes.overCapWarn', { w: w.toFixed(1), c: selectedVehicle!.capacity }))
      return
    }
    setApiError('')
    const base = {
      name: routeName || undefined,
      vehicleId: selectedVehicleId || undefined,
      deliveryDate: deliveryDate || undefined,
      originAddress: depot.address || undefined,
      originLat: depot.lat,
      originLng: depot.lng,
    }
    if (hasSelectedOrders) {
      createRoute.mutate({ ...base, orderIds: [...selectedOrderIds] })
    } else {
      createRoute.mutate({ ...base, stops: pendingStops })
    }
  }

  const selectedRoute = (routes as Route[]).find((r) => r.id === selectedRouteId) ?? null
  const activeRoutes = (routes as Route[]).filter((r) => r.status !== 'completed' && r.status !== 'in_progress')
  const inProgressRoutes = (routes as Route[]).filter((r) => r.status === 'in_progress')
  const historyRoutes = (routes as Route[]).filter((r) => r.status === 'completed')
  const tabRoutes = historyTab === 'active' ? activeRoutes : historyTab === 'in_progress' ? inProgressRoutes : historyRoutes
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

  const pagedRoutes = usePagedList(visibleRoutes, 20)

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
        label: selectedRoute.originAddress || t('routes.legendStart'),
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

  // Aggregate all items across the route's orders (description -> total quantity)
  const aggregatedItems = (() => {
    const acc: Record<string, number> = {}
    for (const o of orderedStops) {
      for (const it of (o.items ?? [])) {
        const key = (it.name || it.description || '').trim()
        if (!key) continue
        acc[key] = (acc[key] || 0) + (it.quantity || 0)
      }
    }
    return Object.entries(acc).map(([description, quantity]) => ({ description, quantity }))
  })()

  const isOverCapacity = (route: Route) =>
    route.vehicle != null && route.totalWeight > route.vehicle.capacity

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      planned: 'bg-yellow-100 text-yellow-700',
      in_progress: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
    }
    return map[status] ?? 'bg-gray-100 text-gray-600'
  }

  const statusLabel = (status: string) => t(`routes.status.${status}`)
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : null

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
                {t('routes.active')} <span className="ml-1 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">{activeRoutes.length}</span>
              </button>
              <button
                onClick={() => { setHistoryTab('in_progress'); setSelectedRouteId(null) }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${historyTab === 'in_progress' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('routes.inProgress')} <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{inProgressRoutes.length}</span>
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
                {historyTab === 'active' ? t('routes.noActive') : historyTab === 'history' ? t('routes.noCompleted') : t('routes.noInProgress')}
              </div>
            ) : (
              pagedRoutes.pageItems.map((route) => (
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
                      {route.deliveryDate && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate"><Icon icon="mdi:calendar" className="inline align-text-bottom mr-1" />{fmtDate(route.deliveryDate)}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusBadge(route.status)}`}>
                        {statusLabel(route.status)}
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
                      <span className="text-sm font-bold text-primary font-mono">{format(route.totalPrice)}</span>
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
            {visibleRoutes.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md">
                <Pagination
                  page={pagedRoutes.page}
                  totalPages={pagedRoutes.totalPages}
                  total={pagedRoutes.total}
                  from={pagedRoutes.from}
                  to={pagedRoutes.to}
                  pageSize={pagedRoutes.pageSize}
                  onPage={pagedRoutes.setPage}
                />
              </div>
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
                        {selectedRoute.name || selectedRoute.routeCode || t('routes.title')}
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
                              <div className="absolute right-0 top-full mt-2 w-96 max-w-[90vw] max-h-[65vh] overflow-y-auto bg-white rounded-xl shadow-xl border z-30 p-2 space-y-2">
                                {aggregatedItems.length > 0 && (
                                  <div className="bg-amber-50 rounded-lg p-2">
                                    <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1"><Icon icon="mdi:package-variant-closed" />{t('routes.totalLoad')}</p>
                                    <div className="flex flex-wrap gap-1">
                                      {aggregatedItems.map((it, i) => (
                                        <span key={i} className="text-[11px] bg-white border border-amber-200 rounded-full px-2 py-0.5">{it.description} <b>×{it.quantity}</b></span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <p className="text-xs font-semibold text-gray-500 px-1 pt-1">{t('routes.stopsAndPrice', { n: orderedStops.length })}</p>
                                {orderedStops.map((order, idx) => (
                                  <div key={order.id} className="p-2 bg-blue-50 rounded-lg">
                                    <div className="flex items-center gap-2">
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
                                    {(order.items && order.items.length > 0) ? (
                                      <div className="flex flex-wrap gap-1 mt-1.5 pl-7">
                                        {order.items.map((it, i) => (
                                          <span key={i} className="text-[11px] bg-white border rounded-full px-2 py-0.5">{it.name || it.description} <b>×{it.quantity}</b></span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-gray-300 italic mt-1 pl-7">{t('routes.noItems')}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {selectedRoute.status === 'planned' && (
                        <button
                          onClick={() => startRoute.mutate(selectedRoute.id)}
                          disabled={startRoute.isPending}
                          className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1"
                        >
                          <Icon icon="mdi:play-circle-outline" />{startRoute.isPending ? t('routes.starting') : t('routes.start')}
                        </button>
                      )}
                      {selectedRoute.status === 'in_progress' && (
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
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mb-3 shrink-0">
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${statusBadge(selectedRoute.status)}`}>{statusLabel(selectedRoute.status)}</span>
                    <span className="flex items-center gap-1"><Icon icon="mdi:road-variant" />{t('routes.kmInclReturn', { km: selectedRoute.totalDistance.toFixed(1) })}</span>
                    <span className="flex items-center gap-1"><Icon icon="mdi:weight" />{selectedRoute.totalWeight.toFixed(1)} kg</span>
                    <span className="font-semibold text-primary flex items-center gap-1 font-mono"><Icon icon="mdi:cash" />{format(selectedRoute.totalPrice)}</span>
                    {selectedRoute.vehicle && (
                      <span className="flex items-center gap-1"><Icon icon="mdi:truck-outline" />{selectedRoute.vehicle.name}{selectedRoute.vehicle.plate ? ` · ${selectedRoute.vehicle.plate}` : ''}</span>
                    )}
                    {selectedRoute.deliveryDate && (
                      <span className="flex items-center gap-1"><Icon icon="mdi:calendar" />{fmtDate(selectedRoute.deliveryDate)}</span>
                    )}
                    {aggregatedItems.length > 0 && (
                      <span className="flex items-center gap-1"><Icon icon="mdi:package-variant-closed" />{t('routes.totalLoad')}: {aggregatedItems.reduce((s, i) => s + i.quantity, 0)}</span>
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
                                  saveOriginMutation.mutate({ name: newOriginName.trim(), address: depot.address, lat: depot.lat, lng: depot.lng, branchId: user?.branchId ?? undefined })
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
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t('routes.deliveryDateOpt')}</label>
                          <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step3Orders', { n: selectedOrderIds.size + pendingStops.length })}</h4>
                  {expandedStep !== 3 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">{t('routes.ordersSummary', { n: selectedOrderIds.size + pendingStops.length })}</span>
                      {depotSet && selectedVehicleId && <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>}
                    </span>
                  )}
                </button>
                {expandedStep === 3 && (
                  <div className="p-3 border-t space-y-3">
                    {/* Primary: pick from existing available orders */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-sm font-semibold text-gray-700">{t('routes.availableOrders')}</h5>
                      </div>
                      <div className="relative mb-2">
                        <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          value={orderSearch}
                          onChange={(e) => setOrderSearch(e.target.value)}
                          placeholder={t('routes.searchOrders')}
                          className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Barra de capacidad del camión */}
                      {selectedVehicle ? (
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium text-gray-600">
                              {selectedWeight.toFixed(1)} / {capacity} kg ({Math.round(capacityPct)}%)
                            </span>
                            {isFull && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                <Icon icon="mdi:alert-octagon" />LLENO
                              </span>
                            )}
                          </div>
                          <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${capacityBarColor}`}
                              style={{ width: `${Math.min(capacityPct, 100)}%` }}
                            />
                          </div>
                          {isFull && (
                            <p className="text-xs text-red-600 font-medium flex items-center gap-1 mt-1.5">
                              <Icon icon="mdi:truck-alert-outline" />Camión lleno — no cabe más
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mb-3 text-xs text-gray-400 flex items-center gap-1">
                          <Icon icon="mdi:truck-outline" />Elige un vehículo para ver la capacidad
                        </div>
                      )}
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {loadingAvailable ? (
                          <p className="text-sm text-gray-400 text-center py-4">{t('routes.loadingOrders')}</p>
                        ) : (availableOrders as AvailableOrder[]).length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">{t('routes.noAvailOrders')}</p>
                        ) : (
                          (availableOrders as AvailableOrder[]).map((o) => {
                            const checked = selectedOrderIds.has(o.id)
                            // Deshabilita pedidos NO seleccionados que ya no caben en el camión.
                            const wouldExceed = selectedVehicle != null && selectedWeight + (o.weight || 0) > capacity
                            const blocked = !checked && wouldExceed
                            return (
                              <label
                                key={o.id}
                                title={blocked ? 'No cabe en el camión' : undefined}
                                className={`flex items-center gap-3 p-2.5 border rounded-xl ${
                                  blocked
                                    ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed'
                                    : checked
                                      ? 'bg-blue-50 border-blue-300 cursor-pointer'
                                      : 'bg-white hover:bg-gray-50 cursor-pointer'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={blocked}
                                  onChange={() => toggleOrder(o.id)}
                                  className="w-4 h-4 accent-blue-600 shrink-0 disabled:cursor-not-allowed"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{o.customerName}</p>
                                  <p className="text-xs text-gray-500 truncate">{o.endAddress || o.address}</p>
                                  {blocked && (
                                    <p className="text-[11px] text-red-500 font-medium">No cabe en el camión</p>
                                  )}
                                  {o.items && o.items.length > 0 && (
                                    <div
                                      className="inline-flex items-center gap-1 mt-0.5"
                                      title={o.items.map((it) => `${it.name || it.description} ×${it.quantity}`).join('\n')}
                                    >
                                      <span className="text-[10px] bg-gray-100 rounded-full px-1.5 py-0.5 truncate max-w-[130px]">
                                        {o.items[0].name || o.items[0].description} ×{o.items[0].quantity}
                                      </span>
                                      {o.items.length > 1 && (
                                        <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">+{o.items.length - 1}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xs text-gray-500">{Number(o.weight).toFixed(1)} kg</p>
                                  {o.deliveryPrice != null && (
                                    <p className="text-xs font-semibold text-blue-700">{format(o.deliveryPrice)}</p>
                                  )}
                                </div>
                              </label>
                            )
                          })
                        )}
                      </div>
                      {hasSelectedOrders && (
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <span className="font-medium text-gray-600">{t('routes.selectedCount', { n: selectedOrderIds.size })}</span>
                          <span className={selectedOverCapacity ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                            {selectedWeight.toFixed(1)} / {selectedVehicle ? selectedVehicle.capacity : '—'} kg
                          </span>
                        </div>
                      )}
                      {selectedOverCapacity && (
                        <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-1"><Icon icon="mdi:alert-outline" />{t('routes.overCapWarn', { w: selectedWeight.toFixed(1), c: selectedVehicle!.capacity })}</p>
                      )}
                    </div>

                    {/* Secondary: manual order entry */}
                    <details className="border rounded-xl">
                      <summary className="cursor-pointer select-none p-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        {t('routes.manualOrderSection', { n: pendingStops.length })}
                      </summary>
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
                    </details>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button onClick={resetModal} className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
                <button
                  onClick={handleCreateRoute}
                  disabled={!depotSet || !selectedVehicleId || (!hasSelectedOrders && pendingStops.length === 0) || (hasSelectedOrders ? selectedOverCapacity : pendingOverCapacity) || createRoute.isPending}
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
