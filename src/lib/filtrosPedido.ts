import { Prisma } from '@prisma/client'

/**
 * Los filtros del catálogo de pedidos, en un solo sitio.
 *
 * Los usan la lista de pedidos y el armador de rutas, y tienen que significar lo MISMO en
 * los dos: si «expirado» quiere decir una cosa en una pantalla y otra en la de al lado,
 * los números no cuadran y nadie sabe cuál creerse.
 *
 * Y se aplican en la BASE, no en el navegador. Con 50.000 pedidos, filtrar en la pantalla
 * significa mandárselos todos primero — que es exactamente lo que la dejaba colgada.
 */

export interface FiltrosPedido {
  /** Texto libre: folio, cliente, dirección, municipio o vendedor. */
  q: string
  /** `completada` | `en_proceso` | `expirada` | `` (todos). */
  estado: string
  /** `1` sólo archivados, `0` sólo activos, `` los dos. */
  archivado: string
  /** `1` sólo con domicilio, `0` sólo sin domicilio, `` los dos. */
  domicilio: string
  /** `1` sólo los que la APK ya cotizó, `0` sólo los que no, `` los dos. */
  cotizado: string
  municipio: string
  vendedor: string
  /** Id de la sucursal. Acota ADEMÁS del alcance, nunca en su lugar. */
  branchId: string
  /** Rango por la FECHA DEL PEDIDO, `YYYY-MM-DD`. */
  desde: string
  hasta: string
}

export function leerFiltros(params: URLSearchParams): FiltrosPedido {
  const t = (k: string) => params.get(k)?.trim() ?? ''

  return {
    q: t('q').toLowerCase(),
    estado: t('estado'),
    archivado: t('archivado'),
    domicilio: t('domicilio'),
    cotizado: t('cotizado'),
    municipio: t('municipio'),
    vendedor: t('vendedor'),
    branchId: t('branchId'),
    desde: t('desde'),
    hasta: t('hasta'),
  }
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * El rango por la fecha del pedido, con la de copiado de respaldo.
 *
 * Los pedidos que entraron antes de que se guardara `orderDate` lo tienen en null. Sin la
 * segunda rama desaparecerían de cualquier búsqueda por fechas — y desaparecer sin decir
 * nada es peor que salir con la fecha aproximada, que además la pantalla marca.
 */
function porFecha({ desde, hasta }: FiltrosPedido): Prisma.OrderWhereInput | null {
  if (!ES_FECHA.test(desde) && !ES_FECHA.test(hasta)) return null

  const rango: Prisma.DateTimeFilter = {}

  if (ES_FECHA.test(desde)) rango.gte = new Date(`${desde}T00:00:00`)
  // El 'hasta' incluye el día entero: quien escribe el 24 quiere los del 24, no los del
  // 24 a las 00:00.
  if (ES_FECHA.test(hasta)) rango.lte = new Date(`${hasta}T23:59:59.999`)

  return { OR: [{ orderDate: rango }, { orderDate: null, createdAt: rango }] }
}

/**
 * Traduce los filtros a un `where` de Prisma.
 *
 * Devuelve un `AND` de condiciones sueltas y no un objeto plano a propósito: varios
 * filtros necesitan su propio `OR` —la búsqueda, el rango de fechas, lo expirado— y
 * mezclarlos en un solo nivel hace que el último pise a los anteriores en silencio.
 */
export function whereDeFiltros(f: FiltrosPedido): Prisma.OrderWhereInput {
  const condiciones: Prisma.OrderWhereInput[] = []

  if (f.q) {
    // Una sola caja que busca por folio, cliente, dirección, municipio y vendedor: quien
    // la usa no se para a pensar en qué campo está lo que recuerda.
    condiciones.push({
      OR: [
        { customerName: { contains: f.q, mode: 'insensitive' } },
        { operationNumber: { contains: f.q, mode: 'insensitive' } },
        { endAddress: { contains: f.q, mode: 'insensitive' } },
        { address: { contains: f.q, mode: 'insensitive' } },
        { municipio: { contains: f.q, mode: 'insensitive' } },
        { vendedor: { contains: f.q, mode: 'insensitive' } },
      ],
    })
  }

  /**
   * El estado, con «expirada» calculada y contando los que no tienen estado.
   *
   * En PEDIDO sólo se guarda `completada`; «expirada» es que la fecha comprometida ya
   * pasó y el pedido sigue sin completarse. Se calcula aquí y no se guarda: un booleano
   * guardado se queda viejo al día siguiente y empieza a mentir solo.
   *
   * Y «no completada» tiene que incluir los que NO tienen estado. `NOT (estado =
   * 'completada')` sobre un NULL da NULL en SQL, que no es TRUE: la fila se cae del
   * filtro. En producción hay 29 pedidos sin estado y se caían de los TRES filtros a la
   * vez —ni completados, ni en proceso, ni expirados—, así que la suma de los tres no
   * daba el catálogo y no había forma de llegar a ellos.
   */
  const noCompletada: Prisma.OrderWhereInput = {
    OR: [{ estado: null }, { estado: { not: 'completada' } }],
  }

  if (f.estado === 'completada') condiciones.push({ estado: 'completada' })
  if (f.estado === 'en_proceso') {
    condiciones.push({
      AND: [noCompletada, { OR: [{ fechaComprometida: null }, { fechaComprometida: { gte: new Date() } }] }],
    })
  }
  if (f.estado === 'expirada') {
    condiciones.push({ AND: [noCompletada, { fechaComprometida: { lt: new Date() } }] })
  }

  if (f.archivado === '1') condiciones.push({ archivado: true })
  if (f.archivado === '0') condiciones.push({ archivado: false })

  if (f.domicilio === '1') condiciones.push({ requiereDomicilio: true })
  // «Sin domicilio» incluye los que no traen el dato: no saberlo no es llevarlo. Y el
  // `null` se nombra a mano por lo mismo de arriba: `NOT (campo = true)` sobre un NULL da
  // NULL y la fila se cae de los dos lados del filtro.
  if (f.domicilio === '0') {
    condiciones.push({ OR: [{ requiereDomicilio: null }, { requiereDomicilio: false }] })
  }

  if (f.cotizado === '1') condiciones.push({ pedidoCosto: { not: null } })
  if (f.cotizado === '0') condiciones.push({ pedidoCosto: null })

  if (f.municipio) condiciones.push({ municipio: f.municipio })
  if (f.vendedor) condiciones.push({ vendedor: f.vendedor })
  /**
   * Por sucursal.
   *
   * Va como un filtro más y no como alcance: se combina con el `where` del alcance, así
   * que quien sólo ve una sucursal no puede pedir la de otro poniéndolo a mano — el
   * `AND` de los dos no deja pasar nada.
   */
  if (f.branchId) condiciones.push({ branchId: f.branchId })

  const fecha = porFecha(f)

  if (fecha) condiciones.push(fecha)

  return condiciones.length ? { AND: condiciones } : {}
}

/** ¿Se usó algún filtro? Sirve para saber si un cero es «no hay» o «no cuadra ninguno». */
export function hayFiltros(f: FiltrosPedido): boolean {
  return Object.values(f).some((v) => v !== '')
}
