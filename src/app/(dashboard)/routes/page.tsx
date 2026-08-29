'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Navbar from '@/components/Navbar'
import LocationInput, { LocationValue } from '@/components/LocationInput'
import ProductPicker from '@/components/ProductPicker'
import CustomerPicker from '@/components/CustomerPicker'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useAvisos } from '@/components/Avisos'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import Selector from '@/components/Selector'
import Drawer from '@/components/Drawer'
import { duracionDeRuta, enlaceGoogleMaps, horasDeRuta, paradasFueraDelEnlace } from '@/lib/rutaCompartir'
import { imprimirPreDespacho } from '@/lib/imprimirPreDespacho'

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
  municipio?: string | null
  meta?: { cliente?: { municipio?: string | null } | null } | null
  items?: OrderItem[]
}

interface Route {
  id: string
  name?: string | null
  routeCode?: string | null
  status: string
  totalDistance: number
  /** Cuándo salió y cuándo volvió: con las dos se sabe cuánto se demoró. */
  startedAt?: string | null
  finishedAt?: string | null
  totalWeight: number
  totalPrice: number
  originAddress?: string | null
  originLat?: number | null
  originLng?: number | null
  deliveryDate?: string | null
  orders: RouteOrder[]
  vehicleId?: string | null
  vehicle?: { id: string; name: string; type: string; plate: string | null; capacity: number } | null
  /** La sucursal de la ruta. Sin esto, el Super Admin las ve todas revueltas. */
  branch?: { id: string; name: string; externalId?: string | null } | null
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

interface BranchOrigin {
  id: string
  name: string
  address?: string | null
  lat: number
  lng: number
  /** El código (HAB, CMG…): es por donde se cruzan los almacenes de Accesos. */
  externalId?: string | null
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
  pedidoCosto?: number | null
  deliveryDistanceKm?: number | null
  municipio?: string | null
  /** Sale del pedido de PEDIDO: ya viajaba y aquí se estaba ignorando. */
  vendedor?: string | null
  items?: OrderItem[]
}

/** Punto de partida vacío: lo usa el depósito de la ruta antes de elegir uno. */
const emptyLoc: LocationValue = { address: '', lat: null, lng: null }

// Aquí vivían `PendingStop` y `PedidoForm`: el alta de una entrega A MANO, con cliente,
// dirección, productos y peso tecleados en el propio modal de crear ruta.
//
// Se fueron con el flujo manual. Esa entrega la crea Entrega, que es donde está el
// repartidor; tenerlo en los dos sitios permitía que la misma entrega existiera dos veces
// sin que nada las relacionara.

export default function RoutesPage() {
  const { token, user , sucursalId } = useAppStore()
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [enlaceCopiado, setEnlaceCopiado] = useState(false)
  /**
   * Los errores salen como aviso emergente, no dentro del modal.
   *
   * Estaban arriba del formulario, y en uno de cuatro pasos eso queda fuera de pantalla
   * en cuanto has bajado un poco: pulsas Crear, no pasa nada visible, y vuelves a
   * pulsar. El aviso tiene que aparecer donde estás mirando.
   */
  const avisar = useAvisos()
  const setApiError = (texto: string) => { if (texto) avisar(texto, 'error') }

  // Depot (punto de partida)
  const [depot, setDepot] = useState<LocationValue>(emptyLoc)

  /**
   * A qué sucursal se le crea la ruta, y de qué día son los pedidos.
   *
   * Un Super Admin ve las ocho a la vez. Sin decir cuál, la ruta se crea en la que
   * estuviera puesta por casualidad —o en ninguna—, y una ruta en la sucursal
   * equivocada no aparece donde tiene que aparecer.
   *
   * Y el día hace falta porque una ruta se arma con los pedidos de UNA fecha. Con miles
   * en la lista, buscarlos a ojo es lo que hace que la pantalla se sienta lenta aunque
   * el servidor conteste rápido.
   */
  const [sucursalRuta, setSucursalRuta] = useState('')
  const [diaPedidos, setDiaPedidos] = useState('')
  // Los demás filtros de la lista de pedidos: vendedor, distancia máxima y costo mínimo.
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [kmMax, setKmMax] = useState('')
  const [costoMin, setCostoMin] = useState('')
  /**
   * Los mismos filtros que la lista de pedidos.
   *
   * Faltaban justo los dos que deciden si un pedido se puede repartir hoy: en qué estado
   * está y si Entrega ya le puso el costo. Se preguntan a la base —significan lo mismo
   * que en la otra pantalla, salen de `lib/filtrosPedido`— y no sobre lo que ya se trajo.
   */
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroCotizado, setFiltroCotizado] = useState('')
  /**
   * Contra la FACTURA, y por defecto sólo los que cuadran.
   *
   * Lo que se reparte es lo facturado: el cliente cambia lo que pidió antes de que se le
   * facture, y meter en el camión un pedido que cambió es llevar algo distinto de lo que
   * se cobró. Se puede quitar el filtro —a veces hace falta ver los demás— pero no es lo
   * que sale por defecto.
   */
  const [filtroFactura, setFiltroFactura] = useState('cuadra')

  // Existing available orders to pick for the route
  const [orderSearch, setOrderSearch] = useState('')
  const [availMunicipio, setAvailMunicipio] = useState('todos')
  /**
   * Los pedidos elegidos, CON su ficha — no sólo sus identificadores.
   *
   * Se guardaban sólo los ids y el peso se sacaba de la lista que se estaba viendo. Al
   * cambiar de día o de filtro, los elegidos desaparecían de esa lista y con ellos su
   * peso: el camión parecía vacío, dejaba seguir metiendo por encima de su capacidad, y
   * al generar la ruta el servidor rechazaba unos pedidos que la pantalla ya no sabía
   * que llevaba. Guardando la ficha, lo elegido pesa lo mismo se mire lo que se mire.
   */
  const [elegidos, setElegidos] = useState<Map<string, AvailableOrder>>(new Map())
  const selectedOrderIds = useMemo(() => new Set(elegidos.keys()), [elegidos])

  // Accordion: which step of the create modal is expanded (1=depot, 2=vehicle, 3=orders)
  const [expandedStep, setExpandedStep] = useState(1)
  const [showStopsModal, setShowStopsModal] = useState(false)
  // Route list filters (apply to both Active and History tabs)
  const [search, setSearch] = useState('')
  /** Las rutas DE UN CAMIÓN: «¿qué lleva hoy el Vehículo HAB?». */
  const [filtroVehiculo, setFiltroVehiculo] = useState('')
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

  /**
   * Los ALMACENES de cada sucursal. De ahí sale el camión.
   *
   * El punto de partida se elegía de una lista de «puntos guardados» propia de esta
   * aplicación, que es otra copia del mismo dato: el almacén ya está en Accesos y se
   * gestiona en la pantalla de Almacenes. Dos listas para lo mismo terminan en una ruta
   * que se mide desde un punto y un domicilio que se cobra desde otro.
   */
  const { data: almacenes } = useQuery<{ sucursales: { codigo: string; nombre: string; almacenes: { id: string; nombre: string; direccion: string | null; latitud: number | null; longitud: number | null; principal: boolean }[] }[] }>({
    queryKey: ['almacenes', sucursalId],
    queryFn: async () => (await axios.get('/api/almacenes', { headers: { Authorization: `Bearer ${token}` } })).data,
    enabled: !!token,
  })

  // Sucursales (con su ubicación) — usadas como punto de partida por defecto cuando la
  // sucursal aún no tiene un origen guardado.
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as BranchOrigin[]
    },
    enabled: !!token,
  })

  const { data: disponibles, isLoading: loadingAvailable } = useQuery({
    // La sucursal y el día entran en la clave: si no, al cambiarlos se seguiría viendo
    // la lista anterior en cache y parecería que el filtro no hace nada.
    queryKey: ['orders-available', orderSearch, sucursalRuta, diaPedidos, filtroVendedor, kmMax, costoMin, filtroEstado, filtroCotizado, filtroFactura],
    queryFn: async () => {
      const res = await axios.get('/api/orders/available', {
        params: {
          q: orderSearch,
          ...(sucursalRuta ? { branchId: sucursalRuta } : {}),
          ...(diaPedidos ? { fecha: diaPedidos } : {}),
          ...(filtroVendedor ? { vendedor: filtroVendedor } : {}),
          ...(kmMax ? { kmMax } : {}),
          ...(costoMin ? { costoMin } : {}),
          ...(filtroEstado ? { estado: filtroEstado } : {}),
          ...(filtroCotizado ? { cotizado: filtroCotizado } : {}),
          ...(filtroFactura ? { factura: filtroFactura } : {}),
        },
        headers: { Authorization: `Bearer ${token}` },
      })
      /**
       * Con tope, y diciéndolo.
       *
       * El endpoint devuelve `{ orders, total, truncated }`: antes devolvía TODOS los
       * pedidos sin ruta —en producción son doce mil— y la pantalla se quedaba esperando.
       * Se acepta también la forma vieja (un array pelado) por si queda algún cliente sin
       * actualizar.
       */
      const d = res.data

      return Array.isArray(d)
        ? { orders: d as AvailableOrder[], truncated: false, total: d.length }
        : (d as { orders: AvailableOrder[]; truncated: boolean; total: number })
    },
    enabled: !!token,
  })

  const availableOrders = disponibles?.orders ?? []
  const listaRecortada = disponibles?.truncated ?? false

  /**
   * Los vendedores que aparecen en los pedidos disponibles.
   *
   * Se sacan de la propia lista y no de un catálogo: así el desplegable sólo ofrece
   * vendedores que de verdad tienen algo que repartir hoy, en vez de los ochenta y dos.
   */
  /**
   * Las OPCIONES salen de la lista SIN filtrar por vendedor ni municipio.
   *
   * Salían de lo que ya estaba filtrado, así que en cuanto se elegía un vendedor el
   * desplegable se quedaba con ése solo y no había forma de cambiar a otro sin limpiar
   * primero. Lo mismo con el municipio. Ahora se piden aparte —misma sucursal y mismo
   * día, que es lo que de verdad acota— y se refrescan solas cuando cambia cualquiera de
   * los otros filtros.
   */
  const { data: paraFiltros } = useQuery({
    queryKey: ['orders-available-opciones', sucursalRuta, diaPedidos, filtroEstado, filtroCotizado, filtroFactura],
    queryFn: async () => {
      const res = await axios.get('/api/orders/available', {
        params: {
          ...(sucursalRuta ? { branchId: sucursalRuta } : {}),
          ...(diaPedidos ? { fecha: diaPedidos } : {}),
          ...(filtroEstado ? { estado: filtroEstado } : {}),
          ...(filtroCotizado ? { cotizado: filtroCotizado } : {}),
          ...(filtroFactura ? { factura: filtroFactura } : {}),
        },
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = res.data

      return (Array.isArray(d) ? d : d.orders) as AvailableOrder[]
    },
    enabled: !!token,
  })

  const vendedoresEnLista = useMemo(
    () => [...new Set((paraFiltros ?? []).map((o) => o.vendedor).filter(Boolean))].sort() as string[],
    [paraFiltros],
  )

  /**
   * La sucursal viene ELEGIDA de la barra de arriba.
   *
   * Ese selector manda sobre lo que enseña la pantalla, así que preguntar otra vez aquí
   * —con la respuesta ya delante— es un paso de más, y peor: se puede contestar distinto
   * y acabar armando una ruta con los pedidos de una sucursal y el almacén de otra.
   *
   * Sólo se pregunta cuando arriba está puesto «todas»: ahí sí hay algo que decidir. Y a
   * quien pertenece a una sucursal no se le pregunta nunca.
   */
  useEffect(() => {
    if (!branches.length) return

    /**
     * La del token sólo vale si está en la lista.
     *
     * El token dura siete días y lleva la sucursal que la persona tenía al entrar. Si ya
     * no existe, el servidor la ignora —enseña todas— pero aquí se seguía usando: el
     * paso 1 quedaba con un id que no está entre las opciones, así que el desplegable
     * enseñaba «Elige la sucursal…» con una elegida arriba y no había forma de avanzar.
     */
    const suya = branches.find((b) => b.id === user?.branchId)

    if (suya) { setSucursalRuta(suya.id); return }
    // La de la barra de arriba: es la que se está mirando, y preguntarla otra vez con la
    // respuesta delante permite contestar distinto y armar una ruta descuadrada.
    if (sucursalId && branches.some((b) => b.id === sucursalId)) { setSucursalRuta(sucursalId); return }
    if (branches.length === 1) { setSucursalRuta(branches[0].id); return }
    // Arriba se pasó a «todas»: se suelta la elegida para que el paso 1 vuelva a pedirla
    // en vez de quedarse con la anterior, que ya no es la que se está mirando.
    setSucursalRuta('')
  }, [user?.branchId, sucursalId, branches])

  /** Los almacenes CON punto de la sucursal elegida, el principal primero. */
  const almacenesDeLaRuta = useMemo(() => {
    const codigo = (branches as BranchOrigin[]).find((b) => b.id === sucursalRuta)?.externalId

    if (!codigo) return []

    return (almacenes?.sucursales ?? [])
      .find((s) => s.codigo === codigo)?.almacenes
      .filter((a) => a.latitud != null && a.longitud != null)
      .sort((a, b) => Number(b.principal) - Number(a.principal)) ?? []
  }, [almacenes, branches, sucursalRuta])

  /**
   * El punto de partida ES el almacén de la sucursal.
   *
   * Se ponía «el primer punto guardado» y, si no había, la ubicación de la sucursal —que
   * es la oficina, no el almacén—. El domicilio se cobra por la distancia DESDE EL
   * ALMACÉN, así que medir la ruta desde otro sitio da unos kilómetros que no cuadran con
   * lo cobrado. Con almacén principal puesto, este paso no hace falta ni preguntarlo.
   */
  useEffect(() => {
    if (!showModal) return
    const principal = almacenesDeLaRuta[0]

    if (!principal) return
    setDepot({
      address: principal.direccion || principal.nombre,
      lat: principal.latitud as number,
      lng: principal.longitud as number,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, almacenesDeLaRuta])

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
    setExpandedStep(1)
    setApiError('')
    setElegidos(new Map())
    setOrderSearch('')
    setAvailMunicipio('todos')
  }

  const depotSet = depot.lat != null && depot.lng != null

  /**
   * El asistente arranca donde de verdad hay algo que decidir.
   *
   * Los dos primeros pasos —sucursal y punto de partida— ya vienen contestados: la
   * sucursal se elige arriba en la barra y la salida es el almacén de esa sucursal. Salían
   * igual, en verde, para pulsar «Siguiente» dos veces sin cambiar nada.
   */
  useEffect(() => {
    if (!showModal) return
    if (sucursalRuta && depotSet && expandedStep < 3) setExpandedStep(3)
  }, [showModal, sucursalRuta, depotSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedVehicle = (vehicles as Vehicle[]).find((v) => v.id === selectedVehicleId)

  // Municipios distintos (no vacíos) de los pedidos disponibles, ordenados.
  // Igual que los vendedores: de la lista sin filtrar por estos dos, para que elegir uno
  // no borre los demás del desplegable.
  const availMunicipios = Array.from(
    new Set(
      (paraFiltros ?? [])
        .map((o) => (o.municipio || '').trim())
        .filter((m) => m !== '')
    )
  ).sort((a, b) => a.localeCompare(b))

  // Lista de disponibles filtrada por municipio (el search ya lo aplica el backend).
  const filteredAvailable = (availableOrders as AvailableOrder[]).filter(
    (o) => availMunicipio === 'todos' || o.municipio === availMunicipio
  )

  // Selected existing orders (primary flow)
  const selectedOrders = [...elegidos.values()]
  const selectedWeight = selectedOrders.reduce((s, o) => s + (o.weight || 0), 0)
  const selectedOverCapacity = selectedVehicle != null && selectedWeight > selectedVehicle.capacity
  const hasSelectedOrders = selectedOrderIds.size > 0

  // Capacidad del camión seleccionado (para la barra "LLENO / no cabe más").
  const capacity = selectedVehicle?.capacity ?? 0
  const capacityPct = capacity > 0 ? (selectedWeight / capacity) * 100 : 0
  const isFull = selectedVehicle != null && selectedWeight >= capacity
  const capacityBarColor = capacityPct >= 100 ? 'bg-red-500' : capacityPct >= 80 ? 'bg-amber-500' : 'bg-green-500'

  const toggleOrder = (pedido: AvailableOrder) => {
    setElegidos((prev) => {
      const next = new Map(prev)

      if (next.has(pedido.id)) next.delete(pedido.id)
      else next.set(pedido.id, pedido)
      return next
    })
  }

  const handleCreateRoute = () => {
    if (!depotSet || !selectedVehicleId || !hasSelectedOrders) return
    if (selectedOverCapacity) {
      setApiError(t('routes.overCapWarn', { w: selectedWeight.toFixed(1), c: selectedVehicle!.capacity }))
      return
    }
    setApiError('')
    const base = {
      name: routeName || undefined,
      // La sucursal viaja con la ruta. Sin esto se creaba con la que tuviera puesta el
      // alcance —o sin ninguna— y luego no aparecía donde se la buscaba.
      branchId: sucursalRuta || undefined,
      vehicleId: selectedVehicleId || undefined,
      deliveryDate: deliveryDate || undefined,
      originAddress: depot.address || undefined,
      originLat: depot.lat,
      originLng: depot.lng,
    }
    createRoute.mutate({ ...base, orderIds: [...selectedOrderIds] })
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
      || (r.branch?.name || '').toLowerCase().includes(q)
    const created = r.createdAt ? new Date(r.createdAt) : null
    const matchFrom = !dateFrom || (created != null && created >= new Date(dateFrom))
    const matchTo = !dateTo || (created != null && created <= new Date(dateTo + 'T23:59:59.999'))
    const matchVehiculo = !filtroVehiculo || r.vehicle?.id === filtroVehiculo

    return matchName && matchFrom && matchTo && matchVehiculo
  })

  const pagedRoutes = usePagedList(visibleRoutes, 20)

  /**
   * Las rutas de la página, AGRUPADAS POR SUCURSAL.
   *
   * Quien ve una sola sucursal no necesita ningún encabezado: todas son de la suya y
   * repetir su nombre veinte veces es ruido. Pero el Super Admin las ve todas, y en una
   * lista plana dos rutas del mismo día con el mismo aspecto pueden ser de Holguín y de
   * La Habana. Sin nada que las separe, la única forma de saberlo es abrirlas una a una.
   *
   * Se agrupa sólo cuando hay más de una sucursal a la vista, así que la pantalla de
   * quien lleva una sucursal no cambia.
   */
  const grupos = (() => {
    const porSucursal = new Map<string, { nombre: string; rutas: Route[] }>()

    for (const r of pagedRoutes.pageItems as Route[]) {
      const id = r.branch?.id ?? 'sin-sucursal'
      const nombre = r.branch
        ? (r.branch.externalId ? `${r.branch.name} (${r.branch.externalId})` : r.branch.name)
        : 'Sin sucursal'

      if (!porSucursal.has(id)) porSucursal.set(id, { nombre, rutas: [] })
      porSucursal.get(id)!.rutas.push(r)
    }

    return [...porSucursal.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  })()

  const agrupar = grupos.length > 1

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

  /**
   * El PRE-DESPACHO: cuánto hay que sacar del almacén para esta ruta.
   *
   * Sale de lo que se lleva elegido, mientras se elige. Es la pregunta del almacenero
   * —«¿cuántas cajas de malta bajo?»— y hasta ahora había que sumarla a mano abriendo
   * pedido por pedido, o esperar a generar la ruta para verla.
   */
  const preDespacho = useMemo(() => {
    const acc = new Map<string, { producto: string; formatos: number; unidades: number; pesoKg: number }>()

    for (const o of selectedOrders) {
      for (const it of (o.items ?? []) as Array<{ name?: string; description?: string; packs?: number; quantity?: number; weightKg?: number }>) {
        const nombre = (it.name || it.description || '').trim()

        if (!nombre) continue
        const a = acc.get(nombre) ?? { producto: nombre, formatos: 0, unidades: 0, pesoKg: 0 }

        a.formatos += Number(it.packs) || 0
        a.unidades += Number(it.quantity) || 0
        a.pesoKg += Number(it.weightKg) || 0
        acc.set(nombre, a)
      }
    }
    return [...acc.values()].sort((a, b) => b.formatos - a.formatos)
  }, [selectedOrders])

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
      <div className="p-3 sm:p-6 flex-1 flex flex-col overflow-hidden min-h-0">
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
              {/* Por CAMIÓN: es la pregunta de todos los días —«¿qué lleva hoy el
                  Vehículo HAB?»— y había que leerse la lista entera para saberlo. */}
              <Selector
                titulo="Rutas de un camión"
                icono="mdi:truck-outline"
                className="w-full justify-between"
                valor={filtroVehiculo}
                todos="Cualquier vehículo"
                onCambio={setFiltroVehiculo}
                opciones={(vehicles as Vehicle[]).map((v) => ({
                  valor: v.id,
                  etiqueta: v.name,
                  nota: v.status === 'in_use' ? 'en ruta' : undefined,
                }))}
              />

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
                {(search || dateFrom || dateTo || filtroVehiculo) && (
                  <button
                    onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setFiltroVehiculo('') }}
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
              grupos.map((grupo) => (
                <div key={grupo.nombre} className="space-y-3">
                  {/* El encabezado sólo aparece si hay más de una sucursal a la vista. */}
                  {agrupar && (
                    <div className="flex items-center gap-2 pt-1 sticky top-0 z-10 bg-gray-50/95 backdrop-blur py-1.5">
                      <Icon icon="mdi:store-outline" className="text-ink-soft/60 text-base shrink-0" />
                      <h6 className="text-xs font-bold uppercase tracking-wider text-gray-500 truncate">{grupo.nombre}</h6>
                      <span className="text-[11px] text-gray-400 shrink-0">{grupo.rutas.length}</span>
                      <span className="h-px flex-1 bg-gray-200" />
                    </div>
                  )}
                  {grupo.rutas.map((route) => (
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
                      {/* Si la lista va agrupada, el encabezado ya dice la sucursal:
                          repetirla en cada tarjeta sería decir dos veces lo mismo. */}
                      {!agrupar && route.branch && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          <Icon icon="mdi:store-outline" className="inline align-text-bottom mr-1" />{route.branch.name}
                        </p>
                      )}
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
                  ))}
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
                        {selectedRoute.branch && (
                          <span className="ml-2 align-middle text-xs font-medium text-ink-soft/70 bg-ink/[0.04] px-2 py-0.5 rounded-lg">
                            {selectedRoute.branch.name}
                          </span>
                        )}
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
                                {orderedStops.map((order, idx) => {
                                  const municipio = (order.municipio || order.meta?.cliente?.municipio || '').trim()
                                  return (
                                  <div key={order.id} className="p-2.5 bg-white border border-gray-100 rounded-xl shadow-sm">
                                    <div className="flex items-start gap-2.5">
                                      <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">{idx + 1}</span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-gray-800 truncate">{order.customerName}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                          <p className="text-[11px] text-gray-500 truncate">{order.endAddress || order.address}</p>
                                          {municipio && (
                                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                                              <Icon icon="mdi:map-marker-outline" className="text-[11px]" />{municipio}
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[11px] text-gray-400 mt-0.5">{order.weight} kg{order.segmentKm != null ? ` · ${t('routes.kmFromStart', { km: order.segmentKm.toFixed(1) })}` : ''}</p>
                                      </div>
                                      {order.price != null && (
                                        <p className="text-sm font-bold text-blue-700 font-mono shrink-0 mt-0.5">{format(order.price)}</p>
                                      )}
                                    </div>
                                    {(order.items && order.items.length > 0) ? (
                                      <div
                                        className="flex items-center gap-1 mt-2 pl-[2.125rem]"
                                        title={order.items.map((it) => `${it.name || it.description} ×${it.quantity}`).join('\n')}
                                      >
                                        <span className="text-[11px] bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 truncate max-w-[170px]">{order.items[0].name || order.items[0].description} <b>×{order.items[0].quantity}</b></span>
                                        {order.items.length > 1 && (
                                          <span className="text-[11px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium shrink-0">+{order.items.length - 1}</span>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-gray-300 italic mt-1.5 pl-[2.125rem]">{t('routes.noItems')}</p>
                                    )}
                                  </div>
                                  )
                                })}
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

                    {/*
                      CUÁNTO SE DEMORÓ.
                      
                      Se marca sola: la salida al despacharla y el regreso al cerrarla. Es
                      la pregunta del día siguiente —«¿cuánto tardó el camión?»— y hasta
                      ahora no había forma de contestarla.
                    */}
                    {duracionDeRuta(selectedRoute) && (
                      <span className="flex items-center gap-1" title={horasDeRuta(selectedRoute)}>
                        <Icon icon="mdi:timer-outline" />{duracionDeRuta(selectedRoute)}
                      </span>
                    )}

                    {/*
                      La ruta EN GOOGLE MAPS, para mandársela al chofer.
                      
                      Va con el almacén de origen, las paradas en el orden en que se
                      optimizaron y la vuelta al almacén. Se abre en el móvil con la
                      navegación de siempre, que es lo que ya sabe usar.
                    */}
                    {enlaceGoogleMaps(selectedRoute) && (
                      <span className="flex items-center gap-2">
                        <a
                          href={enlaceGoogleMaps(selectedRoute) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <Icon icon="mdi:google-maps" />Abrir en Google Maps
                        </a>
                        {/*
                          Copiar el enlace es lo que se usa de verdad: quien despacha se
                          lo manda por WhatsApp al que reparte, y éste lo abre con la
                          navegación que ya sabe usar.
                        */}
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(enlaceGoogleMaps(selectedRoute) as string)
                            setEnlaceCopiado(true)
                            setTimeout(() => setEnlaceCopiado(false), 2500)
                          }}
                          className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                        >
                          <Icon icon={enlaceCopiado ? 'mdi:check' : 'mdi:content-copy'} />
                          {enlaceCopiado ? 'copiado' : 'copiar enlace'}
                        </button>
                        {/* Si la ruta tiene más paradas de las que admite Google, se DICE:
                            un enlace que se come cinco paradas en silencio manda al chofer
                            a dar media vuelta. */}
                        {paradasFueraDelEnlace(selectedRoute) > 0 && (
                          <span className="text-amber-600">
                            (Google admite 25 paradas: {paradasFueraDelEnlace(selectedRoute)} quedan fuera del enlace)
                          </span>
                        )}
                      </span>
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

      {/*
        El asistente, en un CAJÓN a pantalla completa.

        Era un cuadro centrado de ancho de tarjeta con cuatro pasos dentro, y el último es
        una lista de pedidos con sus filtros: no cabía. Y el botón de generar quedaba al
        final del todo, así que había que recorrer la lista entera para llegar a él — ahora
        vive en el pie, siempre a la vista.
      */}
      <Drawer
        abierto={showModal}
        alCerrar={resetModal}
        titulo={t('routes.modalTitle')}
        subtitulo={branches.find((b) => b.id === sucursalRuta)?.name}
        ancho="completo"
        pie={
          <>
            <button onClick={resetModal} className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreateRoute}
              disabled={!depotSet || !selectedVehicleId || !hasSelectedOrders || selectedOverCapacity || createRoute.isPending}
              className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Icon icon="mdi:map-marker-path" />
              {createRoute.isPending ? t('routes.generating') : t('routes.generate')}
            </button>
          </>
        }
      >
        <div className="mx-auto w-full max-w-6xl">

            {/*
              Dónde estoy y cuánto falta.
              
              Con cuatro pasos plegados, sin esto no se ve si quedan dos o siete. El
              número de paso está en cada cabecera, pero repartido: junto no dice
              "paso 2", dice "paso 2 de 4", que es lo que uno quiere saber.
            */}
            <ol className="flex items-center gap-1 mb-5" aria-label="Pasos">
              {[
                { n: 1, nombre: 'Sucursal', hecho: !!sucursalRuta },
                { n: 2, nombre: 'Salida', hecho: depotSet },
                { n: 3, nombre: 'Vehículo', hecho: !!selectedVehicleId },
                { n: 4, nombre: 'Pedidos', hecho: selectedOrderIds.size > 0 },
              ].map((p) => (
                <li key={p.n} className="flex-1">
                  {/* Volver a un paso ya hecho: como sólo se pinta el actual, ésta es la
                      forma de corregir el de antes sin cancelar y empezar de cero. */}
                  <button
                    type="button"
                    disabled={!p.hecho && expandedStep !== p.n}
                    onClick={() => setExpandedStep(p.n)}
                    className="w-full text-left disabled:cursor-default"
                    title={p.hecho ? `Volver a ${p.nombre}` : p.nombre}
                  >
                    <div
                      className={`h-1 rounded-full transition-colors ${
                        p.hecho ? 'bg-green-600' : expandedStep === p.n ? 'bg-primary' : 'bg-gray-200'
                      }`}
                    />
                    <span
                      className={`mt-1 block text-[11px] truncate ${
                        expandedStep === p.n ? 'font-semibold text-gray-800' : 'text-gray-400'
                      }`}
                    >
                      {p.nombre}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="space-y-6">

              {expandedStep === 1 && (
              <>
              {/*
                Paso 1: la sucursal.
                
                Va primero porque condiciona todo lo demás: el punto de partida, los
                vehículos y los pedidos que se pueden elegir son los de ESA sucursal. Un
                Super Admin ve las ocho, y sin decir cuál, la ruta acaba creada donde
                estuviera puesto por casualidad — y ahí no la busca nadie.
              */}
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedStep(1)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white ${sucursalRuta ? 'bg-green-600' : 'bg-gray-300'}`}>1</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">Sucursal</h4>
                  {expandedStep !== 1 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">
                        {branches.find((b) => b.id === sucursalRuta)?.name || 'Sin elegir'}
                      </span>
                      <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>
                    </span>
                  )}
                </button>
                {expandedStep === 1 && (
                  <div className="p-3 border-t space-y-2">
                    <Selector
                        titulo="Sucursal de la ruta"
                        className="w-full justify-between"
                        valor={sucursalRuta}
                        todos="Elige la sucursal…"
                        onCambio={setSucursalRuta}
                        opciones={branches.map((b) => ({ valor: b.id, etiqueta: b.name }))}
                      />
                    <p className="text-xs text-gray-500">
                      Los pedidos, los vehículos y el punto de partida serán los de esta sucursal.
                    </p>
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={!sucursalRuta}
                        onClick={() => setExpandedStep(2)}
                        className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </>
              )}

              {/*
                UN paso a la vez.

                Se pinta SÓLO el que toca. Estaban todos —los hechos plegados arriba y el
                siguiente debajo—, así que con dos completados había cuatro cajas en
                pantalla para rellenar un campo. Dónde se está y qué falta lo dice la barra
                de arriba, y por ahí se vuelve a uno anterior.

                Estaban los cuatro desde el principio, tres de ellos apagados y sin poder
                pulsarse: cuatro cajas grises que no dicen qué hacer. Ahora sale el que
                toca, y los ya hechos se quedan arriba plegados para poder volver.
              */}
              {sucursalRuta && expandedStep === 2 && (
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  disabled={!sucursalRuta}
                  onClick={() => sucursalRuta && setExpandedStep(2)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white ${sucursalRuta ? 'bg-green-600' : 'bg-gray-300'}`}>2</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step1')}</h4>
                  {expandedStep !== 2 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">
                        {depotSet ? (depot.address || `${depot.lat!.toFixed(4)}, ${depot.lng!.toFixed(4)}`) : t('routes.notSet')}
                      </span>
                      <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>
                    </span>
                  )}
                </button>
                {expandedStep === 2 && (
                  <div className="p-3 border-t space-y-2">
                    {/*
                      El punto de partida ES un almacén de la sucursal.
                      
                      Había una lista de «puntos guardados» propia de esta aplicación:
                      otra copia del mismo dato. El almacén vive en Accesos y se gestiona
                      en la pantalla de Almacenes, y es desde donde se cobra el domicilio
                      — medir la ruta desde otro sitio da unos kilómetros que no cuadran
                      con lo que se cobró.
                    */}
                    {almacenesDeLaRuta.length === 0 ? (
                      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Esta sucursal no tiene ningún almacén con ubicación. Se pone en
                        <b> Almacenes</b>, y hasta entonces no hay desde dónde medir.
                      </p>
                    ) : (
                      <>
                        {almacenesDeLaRuta.length > 1 && (
                          <Selector
                            titulo="Almacén del que sale el camión"
                            className="w-full justify-between"
                            valor={depot.address}
                            onCambio={(v) => {
                              const a = almacenesDeLaRuta.find((x) => (x.direccion || x.nombre) === v)

                              if (a) setDepot({ address: a.direccion || a.nombre, lat: a.latitud as number, lng: a.longitud as number })
                            }}
                            opciones={almacenesDeLaRuta.map((a) => ({
                              valor: a.direccion || a.nombre,
                              etiqueta: a.nombre,
                              nota: a.principal ? 'principal' : undefined,
                            }))}
                          />
                        )}

                        <p className="text-xs text-gray-500">
                          {depot.address || 'Sin almacén elegido'}
                        </p>

                        <div className="rounded-xl overflow-hidden border">
                          <MapComponent
                            height="220px"
                            stops={depotSet ? [{ id: 'almacen', lat: depot.lat as number, lng: depot.lng as number, label: depot.address || 'Almacén', isOrigin: true }] : []}
                          />
                        </div>
                      </>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={!depotSet}
                        onClick={() => setExpandedStep(3)}
                        className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        {t('routes.continue')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              )}

              {/* Step 3 — vehicle (required) + name */}
              {depotSet && expandedStep === 3 && (
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  disabled={!depotSet}
                  onClick={() => depotSet && setExpandedStep(3)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step2Vehicle')}</h4>
                  {expandedStep !== 3 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">
                        {selectedVehicle ? `${selectedVehicle.name}${selectedVehicle.plate ? ` (${selectedVehicle.plate})` : ''}${routeName ? ` · ${routeName}` : ''}` : t('routes.notSet')}
                      </span>
                      {depotSet && <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>}
                    </span>
                  )}
                </button>
                {expandedStep === 3 && (
                  <div className="p-3 border-t space-y-3">
                    {/*
                      Se ofrecen TODOS los camiones, también el que está repartiendo.
                      
                      Se filtraban por «disponible», así que el que estaba en la calle no
                      salía — y planificar la ruta de mañana se hace justamente mientras
                      el camión está fuera. El que está ocupado se marca, y la ruta nace
                      planificada: no lo toma hasta que se pone en curso.
                    */}
                    {(vehicles as Vehicle[]).length === 0 ? (
                      <div className="bg-amber-50 text-amber-700 px-3 py-2 rounded-xl text-sm">
                        {t('routes.noVehiclesAvail')}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Selector
                            titulo="Vehículo de la ruta"
                            className="w-full justify-between"
                            valor={selectedVehicleId}
                            todos="Elige el vehículo…"
                            onCambio={setSelectedVehicleId}
                            opciones={vehicles.map((v) => ({
                              valor: v.id,
                              etiqueta: v.name,
                              nota: v.status === 'in_use' ? `${v.capacity} kg · en ruta` : `${v.capacity} kg`,
                            }))}
                          />
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
                            onClick={() => setExpandedStep(4)}
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

              )}

              {/* Step 4 — client orders */}
              {depotSet && selectedVehicleId && expandedStep === 4 && (
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  disabled={!(depotSet && selectedVehicleId)}
                  onClick={() => depotSet && selectedVehicleId && setExpandedStep(3)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed"
                >
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">4</span>
                  <h4 className="font-semibold text-gray-800 shrink-0">{t('routes.step3Orders', { n: selectedOrderIds.size })}</h4>
                  {expandedStep !== 4 && (
                    <span className="ml-auto flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-500 truncate max-w-[240px]">{t('routes.ordersSummary', { n: selectedOrderIds.size })}</span>
                      {depotSet && selectedVehicleId && <span className="text-xs text-blue-600 shrink-0">{t('common.edit')}</span>}
                    </span>
                  )}
                </button>
                {expandedStep === 4 && (
                  /*
                    En DOS columnas: los pedidos a la izquierda y el pre-despacho a la
                    derecha, fijo. Estaba todo en una sola columna estrecha —con el cajón
                    a pantalla completa vacío a los lados— y para ver cuánto llevaba que
                    sacar del almacén había que bajar hasta el final.
                  */
                  <div className="p-3 border-t grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    {/* Primary: pick from existing available orders */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-sm font-semibold text-gray-700">{t('routes.availableOrders')}</h5>
                      </div>

                      {/* Una lista recortada en silencio se lee como "esto es todo lo que
                          hay", y quien arma la ruta da por hecho que no falta nada. */}
                      {listaRecortada && (
                        <p className="mb-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                          <Icon icon="mdi:alert-outline" className="mt-px shrink-0 text-sm" />
                          <span>
                            Hay más pedidos de los que caben en la lista. Elegí la sucursal y el día
                            para verlos todos: una ruta se arma con los de un sitio y un día.
                          </span>
                        </p>
                      )}

                      {/*
                        Sucursal y día, antes que el buscador.
                        
                        Una ruta se arma con los pedidos de UNA sucursal y UN día: eso
                        acota de miles a decenas, y sólo entonces buscar por nombre tiene
                        sentido. Al revés —buscar primero entre todo— es lo que hacía
                        esta pantalla inservible.
                      */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Selector
                        titulo="Sucursal de la ruta"
                        className="w-full justify-between"
                        valor={sucursalRuta}
                        todos="Elige la sucursal…"
                        onCambio={setSucursalRuta}
                        opciones={branches.map((b) => ({ valor: b.id, etiqueta: b.name }))}
                      />
                        <input
                          type="date"
                          value={diaPedidos}
                          onChange={(e) => setDiaPedidos(e.target.value)}
                          className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label="Día de los pedidos"
                        />
                        {diaPedidos && (
                          <button
                            type="button"
                            onClick={() => setDiaPedidos('')}
                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                          >
                            Todos los días
                          </button>
                        )}
                      </div>

                      {/*
                        Vendedor, distancia y costo.
                        
                        Cada uno responde a una pregunta real al armar la ruta: de quién
                        son los clientes —los de un mismo vendedor caen cerca unos de
                        otros—, hasta dónde llega el camión, y si el domicilio compensa
                        el viaje. El vendedor ya venía en el pedido de PEDIDO y aquí se
                        estaba ignorando.
                      */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Selector
                          titulo="Vendedor del pedido"
                          valor={filtroVendedor}
                          todos="Todos los vendedores"
                          onCambio={setFiltroVendedor}
                          opciones={vendedoresEnLista.map((v) => ({ valor: v, etiqueta: v }))}
                          /* Con buscador siempre: los nombres son largos y parecidos
                             —tres MARTINEZ seguidos— y se teclea antes que se lee. */
                          desdeCuantas={0}
                        />
                        <input
                          type="number" min="0" step="0.5"
                          value={kmMax}
                          onChange={(e) => setKmMax(e.target.value)}
                          placeholder="km máx."
                          className="w-24 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label="Distancia máxima en kilómetros"
                        />
                        <input
                          type="number" min="0" step="0.5"
                          value={costoMin}
                          onChange={(e) => setCostoMin(e.target.value)}
                          placeholder="costo mín."
                          className="w-28 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label="Costo mínimo del domicilio"
                        />
                        {/* Contra la FACTURA. Por defecto, sólo lo que cuadra: es lo que
                            se puede repartir sin llevar algo distinto de lo cobrado. */}
                        <Selector
                          titulo="Cuadre con la factura de Ventra"
                          icono="mdi:file-check-outline"
                          valor={filtroFactura}
                          todos="Cuadre: todos"
                          onCambio={setFiltroFactura}
                          opciones={[
                            { valor: 'cuadra', etiqueta: 'Sólo los que cuadran' },
                            { valor: 'cambiado', etiqueta: 'Cambió en la factura' },
                            { valor: 'sin_factura', etiqueta: 'Sin facturar todavía' },
                          ]}
                        />
                        <Selector
                          titulo="Estado del pedido en PEDIDO"
                          valor={filtroEstado}
                          todos="Cualquier estado"
                          onCambio={setFiltroEstado}
                          opciones={[
                            { valor: 'en_proceso', etiqueta: 'En proceso' },
                            { valor: 'completada', etiqueta: 'Completada' },
                            { valor: 'expirada', etiqueta: 'Expirada' },
                          ]}
                        />
                        {/* Sin costo de Entrega el pedido se puede meter igual en la ruta,
                            pero no se sabe lo que se cobra por llevarlo: conviene poder
                            separarlos. */}
                        <Selector
                          titulo="Si Entrega ya le puso costo de domicilio"
                          valor={filtroCotizado}
                          todos="Cotizados y sin cotizar"
                          onCambio={setFiltroCotizado}
                          opciones={[
                            { valor: '1', etiqueta: 'Ya cotizados' },
                            { valor: '0', etiqueta: 'Sin cotizar' },
                          ]}
                        />
                        {(filtroVendedor || kmMax || costoMin || filtroEstado || filtroCotizado) && (
                          <button
                            type="button"
                            onClick={() => { setFiltroVendedor(''); setKmMax(''); setCostoMin(''); setFiltroEstado(''); setFiltroCotizado('') }}
                            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>

                      <div className="flex gap-2 mb-2">
                        <div className="relative flex-1">
                          <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={orderSearch}
                            onChange={(e) => setOrderSearch(e.target.value)}
                            placeholder={t('routes.searchOrders')}
                            className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <Selector
                          titulo="Municipio del cliente"
                          valor={availMunicipio === 'todos' ? '' : availMunicipio}
                          todos="Todos los municipios"
                          onCambio={(v) => setAvailMunicipio(v || 'todos')}
                          opciones={availMunicipios.map((m) => ({ valor: m, etiqueta: m }))}
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
                        ) : filteredAvailable.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">{t('routes.noAvailOrders')}</p>
                        ) : (
                          filteredAvailable.map((o) => {
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
                                  onChange={() => toggleOrder(o)}
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
                                  {/* Lo que se cobra por ese domicilio, que lo pone Entrega. */}
                                  {o.pedidoCosto != null ? (
                                    <p className="text-xs font-semibold text-blue-700">{format(o.pedidoCosto)}</p>
                                  ) : (
                                    <p className="text-[11px] text-gray-400">sin cotizar</p>
                                  )}
                                </div>
                              </label>
                            )
                          })
                        )}
                      </div>
                      {hasSelectedOrders && (
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <span className="font-medium text-gray-600">
                            {t('routes.selectedCount', { n: selectedOrderIds.size })}
                            {/*
                              Los que ya no salen con el filtro puesto SIGUEN en la ruta.
                              
                              Al cambiar de día desaparecían de la lista y parecía que se
                              habían soltado: no era así —seguían contando y pesando—, y
                              esa diferencia entre lo que se ve y lo que se lleva es la
                              que hacía que el camión se pasara de capacidad sin avisar.
                            */}
                            {(() => {
                              const fuera = selectedOrders.filter(
                                (e) => !(availableOrders as AvailableOrder[]).some((o) => o.id === e.id),
                              ).length

                              return fuera > 0 ? (
                                <span className="ml-1 text-gray-400">
                                  ({fuera} de otro día o filtro, siguen contando)
                                </span>
                              ) : null
                            })()}
                          </span>
                          <span className={selectedOverCapacity ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                            {selectedWeight.toFixed(1)} / {selectedVehicle ? selectedVehicle.capacity : '—'} kg
                          </span>
                        </div>
                      )}
                      {selectedOverCapacity && (
                        <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-1"><Icon icon="mdi:alert-outline" />{t('routes.overCapWarn', { w: selectedWeight.toFixed(1), c: selectedVehicle!.capacity })}</p>
                      )}
                    </div>

                    {/*
                      EL PRE-DESPACHO, mientras se eligen los pedidos.
                      
                      Es lo que hay que sacar del almacén y montar en el camión: empaques
                      y unidades de cada producto. Se veía sólo después de generar la
                      ruta, así que había que generarla para saber si cabía o si faltaba
                      algo, y deshacerla si no.
                      
                      Aquí no se crean entregas a mano: eso lo hace Entrega, que es donde
                      está el repartidor. Tenerlo en dos sitios significa que la misma
                      entrega existe dos veces y nada las relaciona.
                    */}
                    <aside className="lg:sticky lg:top-0 lg:self-start">
                      <div className="rounded-xl border bg-amber-50/60 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h5 className="text-sm font-semibold text-gray-800 flex items-center gap-1">
                            <Icon icon="mdi:clipboard-list-outline" />Pre-despacho
                          </h5>
                          <button
                            type="button"
                            disabled={preDespacho.length === 0}
                            onClick={() => imprimirPreDespacho({
                              sucursal: branches.find((b) => b.id === sucursalRuta)?.name ?? '',
                              vehiculo: selectedVehicle?.name ?? '',
                              dia: diaPedidos,
                              pedidos: selectedOrders.length,
                              pesoKg: selectedWeight,
                              lineas: preDespacho,
                            })}
                            className="flex items-center gap-1 text-xs text-primary hover:underline disabled:text-gray-400 disabled:no-underline"
                          >
                            <Icon icon="mdi:printer-outline" />Imprimir
                          </button>
                        </div>

                        {preDespacho.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            Según vayas eligiendo pedidos, aquí sale cuánto hay que sacar de cada
                            producto.
                          </p>
                        ) : (
                          <>
                            <div className="max-h-[22rem] overflow-y-auto -mx-1 px-1">
                              <table className="w-full text-xs">
                                <thead className="text-gray-500">
                                  <tr>
                                    <th className="text-left font-medium pb-1">Producto</th>
                                    <th className="text-right font-medium pb-1">Emp.</th>
                                    <th className="text-right font-medium pb-1">Uds.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {preDespacho.map((l) => (
                                    <tr key={l.producto} className="border-t border-amber-200/60">
                                      <td className="py-1 pr-2">{l.producto}</td>
                                      <td className="py-1 text-right font-mono font-semibold">{l.formatos}</td>
                                      <td className="py-1 text-right font-mono text-gray-600">{l.unidades}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-2 border-t border-amber-200 pt-2 text-xs text-gray-700 space-y-0.5">
                              <p className="flex justify-between">
                                <span>Pedidos</span><b className="font-mono">{selectedOrders.length}</b>
                              </p>
                              <p className="flex justify-between">
                                <span>Empaques</span>
                                <b className="font-mono">{preDespacho.reduce((t, l) => t + l.formatos, 0)}</b>
                              </p>
                              <p className="flex justify-between">
                                <span>Unidades</span>
                                <b className="font-mono">{preDespacho.reduce((t, l) => t + l.unidades, 0)}</b>
                              </p>
                              <p className={`flex justify-between ${selectedOverCapacity ? 'text-amber-700 font-semibold' : ''}`}>
                                <span>Peso</span>
                                <b className="font-mono">
                                  {selectedWeight.toFixed(1)}{selectedVehicle ? ` / ${selectedVehicle.capacity}` : ''} kg
                                </b>
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </aside>
                  </div>
                )}
              </div>

              )}
            </div>
        </div>
      </Drawer>
    </div>
  )
}
