'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false })
import Pagination from '@/components/Pagination'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import Selector from '@/components/Selector'

interface OrderItem {
  name?: string
  description?: string
  packaging?: string | null
  quantity: number
  packs?: number | null
  weightKg?: number | null     // peso de la línea (empaques × peso por empaque)
  unitWeightKg?: number | null // peso por empaque (blister) del almacén
  matched?: boolean            // false = producto sin match de peso
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
  vendedor?: string | null
  /** El estado EN PEDIDO: 'completada', 'en_proceso' o nada. */
  estado?: string | null
  archivado?: boolean
  fechaComprometida?: string | null
  requiereDomicilio?: boolean | null
  /** Lo que la APK cobró de domicilio EN PEDIDO. No es `price`, que es el de delivery. */
  pedidoCosto?: number | null
  items?: OrderItem[]
  /** La fecha del pedido EN PEDIDO. `createdAt` es cuándo lo copió el espejo. */
  orderDate?: string | null
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
  const [municipioFilter, setMunicipioFilter] = useState('')
  const [vendedorFilter, setVendedorFilter] = useState('')
  const [sucursalFilter, setSucursalFilter] = useState('')
  // Los filtros del CATÁLOGO, los que aplica el servidor. Vacío = sin filtrar.
  const [estado, setEstado] = useState('')
  const [archivado, setArchivado] = useState('')
  const [domicilio, setDomicilio] = useState('')
  const [cotizado, setCotizado] = useState('')
  // Rango de fechas del PEDIDO (no de cuándo lo copió el espejo).
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)
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

  /**
   * La búsqueda espera medio segundo antes de preguntar.
   *
   * Sin eso son ocho consultas contra 50.000 pedidos para escribir "Sánchez".
   */
  const [buscado, setBuscado] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setBuscado(search.trim()), 400)

    return () => clearTimeout(id)
  }, [search])

  // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 7 de una lista que
  // ahora tiene 2 páginas enseña un vacío que parece un fallo.
  useEffect(() => {
    setPagina(1)
  }, [buscado, estado, archivado, domicilio, cotizado, municipioFilter, vendedorFilter, sucursalFilter, desde, hasta])

  /**
   * Los pedidos, filtrados y paginados POR EL SERVIDOR.
   *
   * Son 50.000: filtrar en la pantalla obliga a mandárselos todos primero, y eso es lo
   * que la dejaba colgada. Aquí sólo viaja la página que se está mirando.
   */
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', { buscado, estado, archivado, domicilio, cotizado, municipioFilter, vendedorFilter, sucursalFilter, desde, hasta, pagina }],
    queryFn: async () => {
      const res = await axios.get('/api/orders', {
        params: {
          ...(buscado ? { q: buscado } : {}),
          ...(estado ? { estado } : {}),
          ...(archivado ? { archivado } : {}),
          ...(domicilio ? { domicilio } : {}),
          ...(cotizado ? { cotizado } : {}),
          ...(municipioFilter ? { municipio: municipioFilter } : {}),
          ...(vendedorFilter ? { vendedor: vendedorFilter } : {}),
          ...(sucursalFilter ? { branchId: sucursalFilter } : {}),
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
          pagina,
        },
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data as { orders: OrderRow[]; total: number; pagina: number; paginas: number; porPagina: number }
    },
    enabled: !!token,
    // Se mantiene la página anterior mientras llega la nueva: si no, cada cambio deja la
    // tabla en blanco un instante y parece que se vació.
    placeholderData: (previo) => previo,
  })

  const orders = data?.orders ?? []
  const total = data?.total ?? 0
  const paginas = data?.paginas ?? 1

  /** Con qué se puede filtrar. Sale de la base entera, no de la página que se ve. */
  const { data: facetas } = useQuery({
    queryKey: ['orders-facetas'],
    queryFn: async () => {
      const res = await axios.get('/api/orders/facetas', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as {
        municipios: { valor: string; pedidos: number }[]
        vendedores: { valor: string; pedidos: number }[]
        sucursales: { valor: string; nombre: string; pedidos: number }[]
      }
    },
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
  })

  const municipios = facetas?.municipios ?? []
  const vendedores = facetas?.vendedores ?? []
  const sucursales = facetas?.sucursales ?? []

  // Estado de entrega del pedido (para el badge y el filtro):
  //  - Entregado: ya se entregó (deliveredAt) o su ruta está completada.
  //  - En reparto: está en una ruta (asignado, saliendo) pero aún no entregado.
  //  - Pendiente: todavía no está en ninguna ruta.
  const deliveryStatus = (o: OrderRow) => {
    if (o.deliveredAt || o.route?.status === 'completed') return { key: 'entregado', label: 'Entregado', cls: 'bg-green-100 text-green-700' }
    if (o.routeId || o.route?.id) return { key: 'reparto', label: 'En reparto', cls: 'bg-blue-100 text-blue-700' }
    return { key: 'pendiente', label: 'Pendiente', cls: 'bg-gray-100 text-gray-600' }
  }

  /**
   * El estado EN PEDIDO, que no es el de reparto.
   *
   * Son dos cosas distintas y hay que poder ver las dos: un pedido puede estar
   * «completada» en PEDIDO —el cliente ya lo tiene— y «Pendiente» aquí, porque delivery
   * todavía no lo ha metido en ninguna ruta. Confundirlos es armar rutas de lo ya
   * entregado, o no armarlas de lo que falta.
   */
  const estadoPedido = (o: OrderRow) => {
    if (o.estado === 'completada') return { label: 'Completada', cls: 'bg-emerald-100 text-emerald-700' }
    if (o.fechaComprometida && new Date(o.fechaComprometida) < new Date()) {
      return { label: 'Expirada', cls: 'bg-red-100 text-red-700' }
    }
    return { label: 'En proceso', cls: 'bg-amber-100 text-amber-700' }
  }

  /**
   * La fecha del pedido, con respaldo.
   *
   * `orderDate` es la de PEDIDO y es la buena. Los pedidos que entraron antes de que se
   * guardara no la tienen, y para ésos vale `createdAt` —que es cuándo los copió el
   * espejo— porque es lo único que hay.
   */
  const fechaDe = (o: OrderRow) => o.orderDate || o.createdAt

  /**
   * Lo que queda por filtrar aquí: el estado de REPARTO.
   *
   * Es de delivery, no del catálogo de PEDIDO, y se calcula de la ruta. El resto —texto,
   * estado, archivado, domicilio, municipio, vendedor, fechas— lo hace la base.
   */
  const filtered = orders
    .filter((o) => !sucursalId || o.branch?.id === sucursalId)
    .filter((o) => statusFilter === 'todos' || deliveryStatus(o).key === statusFilter)

  /**
   * El orden se aplica a ESTA página, y se dice en el desplegable.
   *
   * La lista viene de la base ordenada por fecha de pedido. Reordenar por precio o por
   * peso aquí ordena las cincuenta filas que se están viendo, no los cincuenta mil — y
   * pedirle a la base que ordene por eso significaría paginar de otra forma. Se deja
   * porque para mirar una página es útil, pero el desplegable no promete otra cosa.
   */
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'precio_desc': return (b.price ?? 0) - (a.price ?? 0)
      case 'precio_asc': return (a.price ?? 0) - (b.price ?? 0)
      case 'distancia_desc': return (b.deliveryDistanceKm ?? 0) - (a.deliveryDistanceKm ?? 0)
      case 'peso_desc': return (b.weight ?? 0) - (a.weight ?? 0)
      case 'antiguos': return new Date(fechaDe(a)).getTime() - new Date(fechaDe(b)).getTime()
      default: return new Date(fechaDe(b)).getTime() - new Date(fechaDe(a)).getTime()
    }
  })

  /** ¿Hay algún filtro puesto? Sirve para saber si un cero es «no hay» o «no cuadra». */
  const hayFiltro = Boolean(
    buscado || estado || archivado || domicilio || cotizado || municipioFilter || vendedorFilter || sucursalFilter || desde || hasta,
  )

  const limpiarFiltros = () => {
    setSearch(''); setEstado(''); setArchivado(''); setDomicilio(''); setCotizado('')
    setMunicipioFilter(''); setVendedorFilter(''); setSucursalFilter(''); setDesde(''); setHasta('')
  }

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
            <span className="text-sm text-gray-500">
              {total.toLocaleString()} pedidos
              {isFetching && <Icon icon="mdi:loading" className="ml-1.5 inline animate-spin text-gray-400" />}
            </span>

            {/* La SUCURSAL, la primera: es por donde se empieza a mirar cuando se ven
                todas. Con el conteo, para no elegir una vacía y volver. */}
            {sucursales.length > 1 && (
              <Selector
                titulo="Sucursal del pedido"
                valor={sucursalFilter}
                todos="Todas las sucursales"
                onCambio={setSucursalFilter}
                opciones={sucursales.map((s) => ({ valor: s.valor, etiqueta: s.nombre, nota: s.pedidos.toLocaleString() }))}
              />
            )}

            {/* El estado EN PEDIDO. Lo filtra la base, sobre los 50.000, no sobre la
                página que se está viendo. */}
            <Selector
              titulo="Estado del pedido en PEDIDO"
              valor={estado}
              todos="Cualquier estado"
              onCambio={setEstado}
              opciones={[
                { valor: 'en_proceso', etiqueta: 'En proceso' },
                { valor: 'completada', etiqueta: 'Completada' },
                { valor: 'expirada', etiqueta: 'Expirada' },
              ]}
            />

            {/* Archivar en PEDIDO es esconder de su lista, no borrar. Aquí se ven todos
                por defecto: la mayor parte del histórico está archivada. */}
            <Selector
              titulo="Archivados en PEDIDO"
              valor={archivado}
              todos="Archivados y activos"
              onCambio={setArchivado}
              opciones={[
                { valor: '0', etiqueta: 'Sólo activos' },
                { valor: '1', etiqueta: 'Sólo archivados' },
              ]}
            />

            <Selector
              titulo="Si el pedido lleva domicilio"
              valor={domicilio}
              todos="Con y sin domicilio"
              onCambio={setDomicilio}
              opciones={[
                { valor: '1', etiqueta: 'Sólo con domicilio' },
                { valor: '0', etiqueta: 'Sólo sin domicilio' },
              ]}
            />

            {/* El costo lo pone el repartidor desde la APK. Sin él, el pedido no se puede
                meter en una ruta: no se sabe lo que cuesta llevarlo. */}
            <Selector
              titulo="Si la APK de Entrega ya le puso costo de domicilio"
              valor={cotizado}
              todos="Cotizados y sin cotizar"
              onCambio={setCotizado}
              opciones={[
                { valor: '1', etiqueta: 'Ya cotizados por Entrega' },
                { valor: '0', etiqueta: 'Sin cotizar' },
              ]}
            />

            {/* El estado de REPARTO es de delivery, no de PEDIDO: se calcula de la ruta y
                se filtra sobre la página. Son dos cosas distintas a propósito. */}
            <Selector
              titulo="Estado de reparto en delivery (se aplica sobre esta página)"
              valor={statusFilter === 'todos' ? '' : statusFilter}
              todos="Cualquier reparto"
              onCambio={(v) => setStatusFilter(v || 'todos')}
              opciones={[
                { valor: 'pendiente', etiqueta: 'Sin ruta' },
                { valor: 'reparto', etiqueta: 'En reparto' },
                { valor: 'entregado', etiqueta: 'Entregado' },
              ]}
            />

            <Selector
              titulo="Municipio del cliente"
              valor={municipioFilter}
              todos="Todos los municipios"
              onCambio={setMunicipioFilter}
              opciones={municipios.map((m) => ({ valor: m.valor, etiqueta: m.valor, nota: String(m.pedidos) }))}
            />

            {vendedores.length > 0 && (
              <Selector
                titulo="Vendedor del pedido"
                valor={vendedorFilter}
                todos="Todos los vendedores"
                onCambio={setVendedorFilter}
                opciones={vendedores.map((v) => ({ valor: v.valor, etiqueta: v.valor, nota: String(v.pedidos) }))}
              />
            )}

            {/* Por FECHA DEL PEDIDO, no por cuándo lo copió el espejo. */}
            <div className="flex items-center gap-1.5 py-1 px-2.5 border rounded-xl text-sm">
              <Icon icon="mdi:calendar-range" className="text-gray-400" />
              <input
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
                className="text-xs bg-transparent focus:outline-none"
                title="Desde (fecha del pedido)"
              />
              <span className="text-gray-300">→</span>
              <input
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
                className="text-xs bg-transparent focus:outline-none"
                title="Hasta (fecha del pedido)"
              />
              {(desde || hasta) && (
                <button
                  type="button"
                  onClick={() => { setDesde(''); setHasta('') }}
                  className="text-gray-400 hover:text-gray-700"
                  title="Quitar el filtro de fechas"
                >
                  <Icon icon="mdi:close-circle" />
                </button>
              )}
            </div>

            <Selector
              titulo="Cómo se ordena esta página"
              valor={sortBy}
              onCambio={(v) => setSortBy(v || 'recientes')}
              opciones={[
                { valor: 'recientes', etiqueta: 'Más recientes' },
                { valor: 'antiguos', etiqueta: 'Más antiguos' },
                { valor: 'precio_desc', etiqueta: 'Precio: mayor a menor' },
                { valor: 'precio_asc', etiqueta: 'Precio: menor a mayor' },
                { valor: 'distancia_desc', etiqueta: 'Distancia: más larga' },
                { valor: 'peso_desc', etiqueta: 'Peso: mayor' },
              ]}
            />
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
            <div className="p-10 text-center text-gray-500 space-y-2">
              <p>{t('ord.empty')}</p>
              {/* Un cero mudo se lee como "está roto". Casi siempre es que los filtros no
                  dejan pasar nada, y decirlo ahorra buscar el fallo donde no está. */}
              {hayFiltro && (
                <button
                  type="button"
                  onClick={limpiarFiltros}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Ningún pedido cuadra con estos filtros — quitarlos todos
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Sucursal</th>
                  <th className="px-4 py-3 font-semibold">Pedido</th>
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
                {sorted.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b hover:bg-blue-50/40 align-middle cursor-pointer"
                    onClick={() => setDetail(o)}
                  >
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {fmtDate(fechaDe(o))}
                      {/* Sin `orderDate` la fecha es la de copiado, no la del pedido: se
                          avisa en vez de enseñarla como si fuera la buena. */}
                      {!o.orderDate && <span className="ml-1 text-gray-300" title="Pedido copiado antes de que se guardara su fecha: ésta es la del espejo.">≈</span>}
                    </td>
                    {/* De qué sucursal es. Estaba sólo en el detalle, así que la lista
                        —que es donde se decide— no lo decía. */}
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {o.branch?.name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(() => { const e = estadoPedido(o); return (
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${e.cls}`}>{e.label}</span>
                      )})()}
                      {/* Archivado en PEDIDO: sigue estando y se puede rutear, pero
                          allí ya está fuera de la lista. Verlo evita armar una ruta
                          creyendo que es de esta semana. */}
                      {o.archivado && (
                        <span className="ml-1 text-gray-300" title="Archivado en PEDIDO">
                          <Icon icon="mdi:archive-outline" className="inline text-xs" />
                        </span>
                      )}
                      {o.requiereDomicilio === false && (
                        <span className="block text-[10px] text-gray-400 mt-0.5">sin domicilio</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {o.customerName}
                      {o.operationNumber && (
                        <span className="block text-[11px] font-mono font-normal text-gray-400">{o.operationNumber}</span>
                      )}
                    </td>
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
                            {itemLabel(o.items[0])} <b>×{o.items[0].packs ?? o.items[0].quantity}</b>
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
                                  <b className="shrink-0 text-gray-900">×{it.packs ?? it.quantity} <span className="font-normal text-gray-400">emp.</span></b>
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
              page={pagina}
              totalPages={paginas}
              total={total}
              from={(pagina - 1) * (data?.porPagina ?? 50) + 1}
              to={Math.min(pagina * (data?.porPagina ?? 50), total)}
              pageSize={data?.porPagina ?? 50}
              onPage={setPagina}
              /* El tamaño de página lo pone el servidor: cambiarlo aquí no cambiaría lo
                 que llega. Se deja fijo en vez de ofrecer un control que no hace nada. */
              onPageSize={() => {}}
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
                          <p className="text-[11px] text-gray-400">
                            {it.quantity != null && `${it.quantity} unidades`}
                            {it.unitWeightKg ? ` · ${it.unitWeightKg.toFixed(2)} kg/empaque` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <b className="text-gray-900">×{it.packs ?? it.quantity} <span className="font-normal text-[11px] text-gray-400">empaques</span></b>
                          {it.weightKg != null && it.weightKg > 0 ? (
                            <p className="text-[11px] font-mono text-gray-500">{it.weightKg.toFixed(2)} kg</p>
                          ) : it.matched === false ? (
                            <p className="text-[11px] text-amber-500">sin peso</p>
                          ) : null}
                        </div>
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
