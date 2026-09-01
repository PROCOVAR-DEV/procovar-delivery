'use client'

import { useState, useEffect } from 'react'
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
import Drawer from '@/components/Drawer'
import { imprimirPreDespacho } from '@/lib/imprimirPreDespacho'
import NuevoPedido from '@/components/NuevoPedido'

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
  /** Cómo quedó contra la factura de Ventra: `igual` | `cambiado` | `sin_factura`. */
  facturaEstado?: string | null
  facturaNumero?: string | null
  /** Lo que pesa la FACTURA. Es lo que sube al camión cuando no coincide con el pedido. */
  pesoFacturado?: number | null
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
  const [nuevo, setNuevo] = useState(false)
  const { format } = useCurrency()
  const t = useT()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recientes')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [municipioFilter, setMunicipioFilter] = useState('')
  const [vendedorFilter, setVendedorFilter] = useState('')
  // Los filtros del CATÁLOGO, los que aplica el servidor. Vacío = sin filtrar.
  const [estado, setEstado] = useState('')
  const [archivado, setArchivado] = useState('')
  const [domicilio, setDomicilio] = useState('')
  const [cotizado, setCotizado] = useState('')
  /** Cómo quedó frente a la factura de Ventra. Ver `lib/cotejarFactura`. */
  const [factura, setFactura] = useState('')
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
  }, [buscado, estado, archivado, domicilio, cotizado, factura, municipioFilter, vendedorFilter, statusFilter, desde, hasta])

  /**
   * Los pedidos, filtrados y paginados POR EL SERVIDOR.
   *
   * Son 50.000: filtrar en la pantalla obliga a mandárselos todos primero, y eso es lo
   * que la dejaba colgada. Aquí sólo viaja la página que se está mirando.
   */
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', { buscado, estado, archivado, domicilio, cotizado, factura, municipioFilter, vendedorFilter, statusFilter, desde, hasta, pagina }],
    queryFn: async () => {
      const res = await axios.get('/api/orders', {
        params: {
          ...(buscado ? { q: buscado } : {}),
          ...(estado ? { estado } : {}),
          ...(archivado ? { archivado } : {}),
          ...(domicilio ? { domicilio } : {}),
          ...(cotizado ? { cotizado } : {}),
          ...(factura ? { factura } : {}),
          ...(municipioFilter ? { municipio: municipioFilter } : {}),
          ...(vendedorFilter ? { vendedor: vendedorFilter } : {}),
          ...(statusFilter !== 'todos' ? { reparto: statusFilter } : {}),
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
          pagina,
        },
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data as {
        orders: OrderRow[]
        total: number
        pagina: number
        paginas: number
        porPagina: number
        /** El pre-despacho de todo lo filtrado; `null` si son demasiados para sumarlos. */
        resumen: { producto: string; formatos: number; unidades: number; pesoKg: number }[] | null
        pesoTotal: number
      }
    },
    enabled: !!token,
    // Se mantiene la página anterior mientras llega la nueva: si no, cada cambio deja la
    // tabla en blanco un instante y parece que se vació.
    placeholderData: (previo) => previo,
  })

  const orders = data?.orders ?? []
  const total = data?.total ?? 0
  const paginas = data?.paginas ?? 1
  /**
   * El PRE-DESPACHO, aparte y sólo cuando se abre.
   *
   * Sumarlo es leerse todos los pedidos filtrados con sus líneas; pedirlo junto con la
   * lista la volvía lenta, y la lista se recarga con cada tecla del buscador.
   */
  const [verResumen, setVerResumen] = useState(false)
  const { data: datosResumen, isFetching: cargandoResumen } = useQuery({
    queryKey: ['orders-resumen', { buscado, estado, archivado, domicilio, cotizado, municipioFilter, vendedorFilter, statusFilter, desde, hasta }],
    queryFn: async () => {
      const res = await axios.get('/api/orders', {
        params: {
          resumen: 1,
          porPagina: 1,
          ...(buscado ? { q: buscado } : {}),
          ...(estado ? { estado } : {}),
          ...(archivado ? { archivado } : {}),
          ...(domicilio ? { domicilio } : {}),
          ...(cotizado ? { cotizado } : {}),
          ...(municipioFilter ? { municipio: municipioFilter } : {}),
          ...(vendedorFilter ? { vendedor: vendedorFilter } : {}),
          ...(statusFilter !== 'todos' ? { reparto: statusFilter } : {}),
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
        },
        headers: { Authorization: `Bearer ${token}` },
      })

      return res.data as {
        resumen: { producto: string; formatos: number; unidades: number; pesoKg: number }[] | null
        pesoTotal: number
        total: number
      }
    },
    enabled: !!token && verResumen,
  })

  const resumen = datosResumen?.resumen ?? null
  const pesoTotal: number = datosResumen?.pesoTotal ?? 0

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
   * Ya no queda nada que filtrar aquí: TODO lo hace la base, incluido el estado de
   * reparto. Filtrarlo sobre la página era lo que dejaba la tabla vacía con el conteo
   * diciendo 358 — los que estaban en una ruta vivían en otra página.
   */
  const filtered = orders.filter((o) => !sucursalId || o.branch?.id === sucursalId)

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
    buscado || estado || archivado || domicilio || cotizado || factura || municipioFilter || vendedorFilter || desde || hasta,
  )

  const limpiarFiltros = () => {
    setSearch(''); setEstado(''); setArchivado(''); setDomicilio(''); setCotizado(''); setFactura('')
    setMunicipioFilter(''); setVendedorFilter(''); setDesde(''); setHasta('')
  }

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—'
  const itemLabel = (it: OrderItem) => it.name || it.description || '—'

  return (
    <div className="flex flex-col">
      <Navbar title={t('ord.title')} />
      <div className="p-3 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-700">{t('ord.title')}</h3>
              <p className="text-sm text-gray-500">{t('ord.subtitle')}</p>
            </div>
            {/*
              El alta MANUAL.

              Casi todos entran solos desde PEDIDO, pero no todos: un cliente que llama,
              una entrega que se arma en el momento. Quitarlo dejó a la gente sin forma de
              meter ésos.
            */}
            <button
              type="button"
              onClick={() => setNuevo(true)}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Icon icon="mdi:plus" />
              Nuevo pedido
            </button>
          </div>
          {/*
            El conteo, en su PROPIA línea.
            
            Compartía fila con los filtros, y su texto cambia de largo al filtrar —«358
            pedidos · desde el 27, del más nuevo al más viejo»—: al crecer, la fila se
            reparte distinto y los desplegables se mueven debajo del ratón. Ése es el
            salto que se veía al filtrar.
          */}
          <div className="flex flex-wrap items-center gap-3">
            {/*
              El conteo DICE de qué días es y en qué orden viene.

              Con «desde el 27» puesto, la lista empieza por los del 28 —van de más nuevo
              a más viejo— y eso se lee como que el filtro no se aplicó. Se aplicaba: son
              los del 27 EN ADELANTE. Decirlo aquí cuesta una línea y quita la duda.
            */}
            <span className="w-full text-sm text-gray-500">
              {total.toLocaleString()} pedidos
              {(desde || hasta) && (
                <span className="text-gray-400">
                  {' · '}
                  {desde && hasta ? (desde === hasta ? `del ${desde}` : `del ${desde} al ${hasta}`) : desde ? `desde el ${desde}` : `hasta el ${hasta}`}
                  {', del más nuevo al más viejo'}
                </span>
              )}
              {isFetching && <Icon icon="mdi:loading" className="ml-1.5 inline animate-spin text-gray-400" />}
            </span>

            {/* La SUCURSAL no se filtra aquí: la manda el selector de la barra de arriba.
                Tener dos sitios donde elegirla es poder elegir dos cosas distintas a la
                vez —y entonces ninguno de los dos dice lo que se está viendo—. Quien sólo
                tiene una sucursal no ve ni ese selector: ya viene puesta. */}

            {/* Cada filtro en su sitio fijo: con `flex-wrap` a secas, un texto que crece
                —«Cotizados y sin cotizar» al elegir— reordenaba la fila entera y el
                desplegable de al lado se movía debajo del ratón. */}
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

            {/*
              Contra la FACTURACIÓN de Ventra.

              El cliente cambia lo que pidió antes de que se le facture, y lo que se
              reparte es lo facturado: es lo que va en el camión y lo que se cobra. «Cuadra
              con la factura» es con lo que se arman las rutas.
            */}
            <Selector
              titulo="Cómo quedó frente a la factura de Ventra"
              icono="mdi:file-check-outline"
              valor={factura}
              todos="Cuadre con la factura: todos"
              onCambio={setFactura}
              opciones={[
                { valor: 'cuadra', etiqueta: 'Sólo los que cuadran' },
                { valor: 'igual', etiqueta: 'Igual que la factura' },
                { valor: 'cambiado', etiqueta: 'Cambió en la factura' },
                { valor: 'sin_factura', etiqueta: 'Sin facturar todavía' },
              ]}
            />

            {/* El estado de REPARTO es de delivery, no de PEDIDO: se calcula de la ruta y
                se filtra sobre la página. Son dos cosas distintas a propósito. */}
            <Selector
              titulo="Estado de reparto en delivery"
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
              {/* Casi siempre se quiere UN día, y poner la misma fecha dos veces es un
                  paso que se olvida: de ahí «esto es de otro día, el filtro no va». */}
              {desde && desde !== hasta && (
                <button
                  type="button"
                  onClick={() => setHasta(desde)}
                  className="text-[11px] text-primary hover:underline"
                  title="Ver sólo ese día"
                >
                  sólo ese día
                </button>
              )}
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

        {/*
          La tabla NO desaparece mientras se filtra.

          Al cambiar un filtro se quedaba «Cargando» en una caja de 80px de alto: la
          página encogía de golpe, la barra de filtros subía y el ratón acababa sobre otro
          desplegable. Ahora se mantiene lo que ya se está viendo, apagado, hasta que llega
          lo nuevo — y el indicador de arriba dice que se está trabajando.
        */}
        {/*
          EL PRE-DESPACHO de lo filtrado.

          Filtrar por un día y una sucursal contesta «cuántos pedidos»; al almacén hay que
          decirle CUÁNTO SACAR: empaques y unidades de cada producto. Se sacaba a mano
          abriendo pedido por pedido.
        */}
        <details
          className="bg-white rounded-2xl shadow-md p-4"
          onToggle={(e) => setVerResumen((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Icon icon="mdi:clipboard-list-outline" className="text-primary" />
              Pre-despacho de lo filtrado
              {resumen && (
                <span className="font-normal text-gray-500">
                  · {resumen.length} producto(s) · {resumen.reduce((t, l) => t + l.formatos, 0)} empaques ·{' '}
                  {pesoTotal.toFixed(1)} kg
                </span>
              )}
              {cargandoResumen && <Icon icon="mdi:loading" className="animate-spin text-gray-400" />}
              <button
                type="button"
                disabled={!resumen?.length}
                onClick={(e) => {
                  e.preventDefault()
                  if (!resumen?.length) return
                  imprimirPreDespacho({
                    sucursal: sucursalId ? (orders[0]?.branch?.name ?? '') : 'Todas las sucursales',
                    vehiculo: '',
                    dia: desde && desde === hasta ? desde : undefined,
                    pedidos: total,
                    pesoKg: pesoTotal,
                    lineas: resumen,
                  })
                }}
                className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Icon icon="mdi:file-eye-outline" />Ver e imprimir
              </button>
            </summary>

            {!resumen && !cargandoResumen && (
              <p className="mt-3 text-xs text-gray-500">
                Son demasiados pedidos para sumarlos. Acotá por día o sucursal y sale.
              </p>
            )}

            {resumen && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left py-1">Producto</th>
                    <th className="text-right py-1">Empaques</th>
                    <th className="text-right py-1">Unidades</th>
                    <th className="text-right py-1">kg</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((l) => (
                    <tr key={l.producto} className="border-t">
                      <td className="py-1.5 pr-3">{l.producto}</td>
                      <td className="py-1.5 text-right font-mono font-semibold">{l.formatos}</td>
                      <td className="py-1.5 text-right font-mono text-gray-600">{l.unidades}</td>
                      <td className="py-1.5 text-right font-mono text-gray-600">{l.pesoKg ? l.pesoKg.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
        </details>

        <div className={`bg-white rounded-2xl shadow-md overflow-x-auto transition-opacity ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
          {isLoading ? (
            <div className="p-8 text-center text-gray-500 min-h-[24rem]">{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-500 space-y-2 min-h-[24rem]">
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
            /*
              Doce columnas no caben en ninguna pantalla, y arrastrar de lado para leer el
              peso es trabajo. Se esconden por orden de lo prescindible:

                Sucursal  — si arriba hay UNA elegida, la columna repite ocho veces lo
                            mismo. Sólo se enseña con «todas».
                Vehículo  — va con la ruta; si no está ruteado son dos guiones.
                Ruta      — lo mismo, y cabe en el detalle.
                Artículos — se ve entero al abrir el pedido.

              Lo que nunca se va: cliente, dirección, peso, precio y estado, que es con lo
              que se decide.
            */
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="px-3 py-3 font-semibold w-[6.5rem]">Fecha</th>
                  {!sucursalId && <th className="px-3 py-3 font-semibold w-[7rem] hidden 2xl:table-cell">Sucursal</th>}
                  <th className="px-3 py-3 font-semibold w-[7.5rem]">Pedido</th>
                  <th className="px-3 py-3 font-semibold">{t('ord.colClient')}</th>
                  <th className="px-3 py-3 font-semibold w-[6rem] hidden xl:table-cell">{t('ord.colRoute')}</th>
                  <th className="px-3 py-3 font-semibold w-[7rem] hidden 2xl:table-cell">{t('ord.colVehicle')}</th>
                  <th className="px-3 py-3 font-semibold w-[10rem] hidden lg:table-cell">{t('ord.colItems')}</th>
                  <th className="px-3 py-3 font-semibold">{t('ord.colAddress')}</th>
                  <th className="px-3 py-3 font-semibold text-right w-[5.5rem]">{t('common.weight')}</th>
                  <th className="px-3 py-3 font-semibold text-right w-[6rem]">{t('common.price')}</th>
                  <th className="px-3 py-3 font-semibold w-[6.5rem] hidden md:table-cell">{t('ord.colDelivery')}</th>
                  <th className="px-2 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b hover:bg-blue-50/40 align-middle cursor-pointer"
                    onClick={() => setDetail(o)}
                  >
                    <td className="px-3 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {fmtDate(fechaDe(o))}
                      {/* Sin `orderDate` la fecha es la de copiado, no la del pedido: se
                          avisa en vez de enseñarla como si fuera la buena. */}
                      {!o.orderDate && <span className="ml-1 text-gray-300" title="Pedido copiado antes de que se guardara su fecha: ésta es la del espejo.">≈</span>}
                    </td>
                    {/* De qué sucursal es. Estaba sólo en el detalle, así que la lista
                        —que es donde se decide— no lo decía. */}
                    {!sucursalId && (
                      <td className="px-3 py-3 text-xs text-gray-600 hidden 2xl:table-cell">
                        <span className="block truncate">{o.branch?.name || '—'}</span>
                      </td>
                    )}
                    <td className="px-3 py-3">
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
                    <td className="px-3 py-3 font-medium">
                      <span className="block truncate">{o.customerName}</span>
                      {o.operationNumber && (
                        <span className="block text-[11px] font-mono font-normal text-gray-400">{o.operationNumber}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden xl:table-cell">
                      {o.route?.routeCode ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">{o.route.routeCode}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-gray-600 text-xs hidden 2xl:table-cell">
                      <span className="block truncate">{o.route?.vehicle?.name || '—'}</span>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
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
                    <td className="px-3 py-3 text-gray-600 text-xs">
                      <span className="block truncate">{o.endAddress || o.address}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs whitespace-nowrap">{o.weight?.toFixed(1)} kg</td>
                    {/* Lo que Entrega le cobró al cliente. `price` es OTRA cosa: el
                        reparto de la carga del camión que calcula delivery, una cuenta
                        interna que no cobra nadie. Enseñar ésa como «Precio» era decir un
                        importe que no coincide con lo que se pagó. */}
                    <td className="px-3 py-3 text-right font-semibold text-green-700 font-mono whitespace-nowrap">
                      {o.pedidoCosto != null ? format(o.pedidoCosto) : <span className="text-gray-300 font-normal">sin cotizar</span>}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      {(() => { const s = deliveryStatus(o); return (
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
                      )})()}
                    </td>
                    <td className="px-2 py-3 text-right text-gray-300"><Icon icon="mdi:chevron-right" /></td>
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

      {/*
        El detalle, en CAJÓN.

        Era un cuadro centrado de ancho de tarjeta, y aquí dentro hay un mapa, la lista de
        productos y el domicilio: todo salía apretado y con su propia barra de desplazamiento.
      */}
      <NuevoPedido abierto={nuevo} alCerrar={() => setNuevo(false)} />

      {mounted && (
        <Drawer
          abierto={detail != null}
          alCerrar={() => setDetail(null)}
          titulo={detail?.customerName ?? ''}
          subtitulo={detail?.operationNumber ?? undefined}
          ancho="lg"
        >
          {detail && (
            <div className="space-y-5">
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

              {/*
                CONTRA LA FACTURA de Ventra.
                
                El cliente cambia lo que pidió antes de que se le facture. Si no se dice
                aquí, se arma la ruta con el pedido viejo y el camión sale con otra cosa
                de la que se cobró — y eso se ve al final del día, cuando ya pasó.
              */}
              {detail.facturaEstado && (
                <div className={`rounded-xl px-4 py-3 text-sm ${
                  detail.facturaEstado === 'igual'
                    ? 'bg-green-50 text-green-800'
                    : detail.facturaEstado === 'cambiado'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-gray-50 text-gray-600'
                }`}>
                  {detail.facturaEstado === 'igual' && (
                    <>Cuadra con la factura {detail.facturaNumero ?? ''} de Ventra: se puede repartir tal cual.</>
                  )}
                  {detail.facturaEstado === 'cambiado' && (
                    <>Se facturó algo distinto de lo pedido (factura {detail.facturaNumero ?? '—'}). Lo que va en el camión es lo facturado.</>
                  )}
                  {detail.facturaEstado === 'sin_factura' && (
                    <>Todavía no aparece facturado en Ventra.</>
                  )}

                  {/*
                    Y CUÁNTO PESA lo facturado.

                    El domicilio se cobra por peso, así que cuando la factura cambia el
                    pedido cambia también lo que hay que cobrar. Delivery lo recalcula con
                    la fórmula de Entrega y se lo manda a PEDIDO, que es donde vive ese
                    precio; aquí se enseñan los dos números para que se vea de dónde sale.
                  */}
                  {detail.pesoFacturado != null && (
                    <p className="mt-1 text-xs">
                      Pedido <b className="font-mono">{detail.weight?.toFixed(2) ?? '—'} kg</b>
                      {' · '}
                      facturado <b className="font-mono">{detail.pesoFacturado.toFixed(2)} kg</b>
                    </p>
                  )}
                </div>
              )}

              {/*
                EL DOMICILIO: lo que cobra PEDIDO, no lo que estimaría delivery.

                Aquí salía el número que delivery calculaba por su cuenta, y en la misma
                pantalla la columna de la lista decía «sin cotizar»: dos cifras distintas
                para el mismo pedido, y la de aquí no la cobra nadie. El precio lo pone el
                repartidor desde Entrega y llega en `pedidoCosto`. Cuando no está, se dice
                —igual que lo dice PEDIDO— en vez de rellenar el hueco con una estimación.

                La distancia y el peso se quedan, pero como lo que son: lo que delivery
                MIDE para armar rutas y llenar el camión, no la base de un cobro.
              */}
              <div className={`rounded-xl p-4 ${detail.pedidoCosto != null ? 'bg-green-50' : 'bg-amber-50'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${detail.pedidoCosto != null ? 'text-green-700' : 'text-amber-700'}`}>
                  Domicilio
                </p>
                <div className="flex items-end justify-between gap-3">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <span className="text-gray-500">Distancia</span>
                    <span className="font-mono text-gray-800">{detail.deliveryDistanceKm != null ? `${detail.deliveryDistanceKm.toFixed(2)} km` : '—'}</span>
                    <span className="text-gray-500">Peso total</span>
                    <span className="font-mono text-gray-800">{detail.weight?.toFixed(2)} kg</span>
                  </div>
                  <div className="text-right">
                    {detail.pedidoCosto != null ? (
                      <p className="text-2xl font-bold text-green-700 font-mono">{format(detail.pedidoCosto)}</p>
                    ) : (
                      <p className="text-sm font-medium text-amber-700">Sin calcular todavía</p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  {detail.pedidoCosto != null
                    ? 'El costo lo puso el repartidor desde Entrega. La distancia es del almacén al cliente.'
                    : 'El costo lo pone el repartidor desde Entrega; hasta entonces este pedido no tiene precio de domicilio.'}
                </p>
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
          )}
        </Drawer>
      )}
    </div>
  )
}
