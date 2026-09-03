import type { Prisma } from '@prisma/client'
import type { HomeDeliveryQuote } from './pricing'
import type { WeightCatalog } from './productMatch'

export interface QuoteItem {
  description?: string
  name?: string
  sku?: string
  code?: string
  weight?: number
  quantity?: number
  packs?: number // nº de unidades de venta (blisters/cajas). El peso del warehouse es POR pack.
  /**
   * El peso que manda PEDIDO, ya cruzado contra Ventra allí. Es la FUENTE BUENA.
   *
   * `pesoKg` es por unidad de venta y `pesoLineaKg` la línea entera. Vienen los dos
   * porque mandar sólo uno obliga a acordarse de multiplicar por `packs`, y el día que
   * se olvide el domicilio sale dividido entre veinticuatro sin que falle nada.
   */
  pesoKg?: number | null
  pesoLineaKg?: number | null
}

export interface OrderQuoteInput {
  sucursalExternalId?: string
  /** La fecha del pedido EN PEDIDO (ISO). No es la de copiado: ver `Order.orderDate`. */
  orderDate?: string | null
  /**
   * Lo que hace falta para filtrar el catálogo EN EL SERVIDOR.
   *
   * Todo esto viaja además dentro de `meta`, pero ahí dentro no se puede filtrar sin leer
   * y descartar el pedido entero de cada fila. Con 50.000 pedidos eso no es un filtro.
   */
  pedidoUpdatedAt?: string | null
  estado?: string | null
  archivado?: boolean
  fechaComprometida?: string | null
  /** El costo que la APK puso EN PEDIDO. No es `deliveryPrice`, que es el reparto de carga. */
  pedidoCosto?: number | null
  /**
   * El cotejo contra la FACTURA, tal como lo dejó PEDIDO.
   *
   * Lo hace PEDIDO —el pedido es suyo, y allí se corrige cuando la factura dice otra
   * cosa—. Aquí llega copiado para poder filtrar: el armador de rutas ofrece por defecto
   * los que cuadran, porque cargar el camión con un pedido que la factura cambió es
   * descuadrar la caja.
   */
  facturaEstado?: string | null
  facturaNumero?: string | null
  facturaAt?: string | Date | null
  facturaDomicilio?: number | null
  /** Cuándo se reescribió el pedido con lo que decía la factura. Null = vino bien. */
  facturaCorregidoAt?: string | Date | null
  municipio?: string | null
  vendedor?: string | null
  sucursalCodigo?: string | null
  customerName?: string
  address?: string
  phone?: string
  lat?: number
  lng?: number
  weight?: number
  items?: QuoteItem[]
  operationNumber?: string
  externalId?: string
  notes?: string
  /** false = el pedido NO lleva domicilio -> no se le calcula costo (queda sin precio). */
  requiereDomicilio?: boolean
  // Payload completo (cliente + pedido) tal como llega de PEDIDO, para guardarlo íntegro.
  meta?: unknown
}

/**
 * Peso total (kg) de un pedido a partir de sus items.
 *  - Si el item trae `weight` explícito (cotización manual), se usa weight × cantidad.
 *  - Si no, se resuelve el peso POR UNIDAD DE VENTA en el catálogo del Data Warehouse
 *    (por código SKU o por nombre normalizado/fuzzy) y se multiplica por `packs` (nº de
 *    unidades de venta). Lo que no matchea o no tiene peso cargado aporta 0 kg.
 * Devuelve 0 si no se pudo resolver nada (peso "sin calcular" para las rutas).
 */
/** Item con su peso ya resuelto (para guardarlo y mostrar el desglose por producto). */
export interface WeightedItem extends QuoteItem {
  weightKg: number       // peso de la LÍNEA (packs × peso por pack). 0 = sin match / sin peso.
  unitWeightKg: number   // peso por unidad de venta (pack) (informativo).
  matched: boolean       // true si se resolvió el peso; false = producto sin match.
  whName?: string | null // nombre del producto en el warehouse con que emparejó.
  /** De dónde salió el peso: de PEDIDO, del catálogo propio, escrito a mano, o de nada. */
  weightSource: 'pedido' | 'manual' | 'catalogo' | 'none'
}

/**
 * Resuelve el peso de CADA item de un pedido y el total.
 *  - Si el item trae `weight` explícito (cotización manual), línea = weight × cantidad.
 *  - Si no, se resuelve el peso POR UNIDAD DE VENTA en el catálogo del Data Warehouse
 *    (por SKU o por nombre normalizado/fuzzy) y línea = peso_por_pack × `packs`.
 *  - Lo que no matchea o no tiene peso cargado aporta 0 kg (matched=false).
 */
export function computeItemsWeights(
  items: QuoteItem[] | undefined,
  catalog?: WeightCatalog,
): { total: number; items: WeightedItem[] } {
  if (!Array.isArray(items) || items.length === 0) return { total: 0, items: [] }
  let total = 0
  const out: WeightedItem[] = items.map((it) => {
    /**
     * PRIMERO el peso que manda PEDIDO.
     *
     * PEDIDO ya cruza cada línea contra Ventra —con los vínculos que ató una persona
     * cuando el nombre no se parecía— y manda el resultado. Volver a cruzarlo aquí
     * contra un catálogo propio es tener el mismo dato dos veces y descubrir tarde que
     * no coinciden: el domicilio se cobra por un peso que no es el nuestro.
     *
     * El catálogo local se queda DETRÁS, no delante: sirve para los pedidos que entraron
     * antes de que PEDIDO mandara el peso, y para el día que PEDIDO no lo tenga.
     */
    const dePedido = Number(it.pesoLineaKg)
    if (Number.isFinite(dePedido) && dePedido > 0) {
      total += dePedido
      const unidad = Number(it.pesoKg)
      return {
        ...it,
        weightKg: dePedido,
        unitWeightKg: Number.isFinite(unidad) && unidad > 0 ? unidad : 0,
        matched: true,
        whName: null,
        weightSource: 'pedido',
      }
    }
    // Sólo el peso por unidad de venta: se multiplica por los packs, igual que allí.
    const unidadPedido = Number(it.pesoKg)
    if (Number.isFinite(unidadPedido) && unidadPedido > 0) {
      const cantidad = Number(it.packs) > 0 ? Number(it.packs) : (Number(it.quantity) || 0)
      const line = unidadPedido * cantidad
      if (line > 0) {
        total += line
        return { ...it, weightKg: line, unitWeightKg: unidadPedido, matched: true, whName: null, weightSource: 'pedido' }
      }
    }

    const manual = Number(it.weight) || 0
    if (manual > 0) {
      const line = manual * (Number(it.quantity) || 1)
      total += line
      return { ...it, weightKg: line, unitWeightKg: manual, matched: true, whName: null, weightSource: 'manual' }
    }
    if (catalog) {
      const hit = catalog.resolve(it.name, it.sku || it.code)
      if (hit.weightKg > 0) {
        const packs = Number(it.packs) || 0
        const line = hit.weightKg * packs
        total += line
        return { ...it, weightKg: line, unitWeightKg: hit.weightKg, matched: true, whName: hit.whName ?? null, weightSource: 'catalogo' }
      }
    }
    return { ...it, weightKg: 0, unitWeightKg: 0, matched: false, whName: null, weightSource: 'none' }
  })
  return { total, items: out }
}

/** Peso total (kg) de un pedido a partir de sus items. Ver `computeItemsWeights`. */
export function weightFromItems(
  items: QuoteItem[] | undefined,
  fallback: number,
  catalog?: WeightCatalog,
): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 0
  const { total } = computeItemsWeights(items, catalog)
  return total > 0 ? total : (fallback || 0)
}

export interface BranchOrigin {
  id: string
  name: string
  lat: number
  lng: number
  creatorId: string
}

export interface OrderQuoteResult {
  weightKg: number
  distanceKm: number
  quote: HomeDeliveryQuote
  // Items con el peso ya resuelto por producto (para guardarlo y mostrar el desglose).
  items: WeightedItem[]
}

/**
 * `computeOrderQuote` se fue con el cotizador individual.
 *
 * Calculaba el precio con `calculateHomeDeliveryPrice` (base + km + kg), que es una
 * fórmula DISTINTA de la oficial que usa el lote (C = CKK x D x PP). Su único cliente era
 * `/api/quote`, que ya no existe: dejarlo aquí es dejar a mano la segunda fórmula que
 * hacía que el mismo pedido costara dos cosas distintas.
 */

/** Arma el objeto `data` para crear/actualizar el Order en delivery. */
export function buildOrderData(
  input: OrderQuoteInput,
  branch: BranchOrigin,
  computed: OrderQuoteResult,
) {
  return {
    operationNumber: input.operationNumber || null,
    customerName: input.customerName as string,
    address: input.address || (input.customerName as string),
    endAddress: input.address || null,
    endLat: input.lat as number,
    endLng: input.lng as number,
    lat: input.lat as number,
    lng: input.lng as number,
    // Peso REAL para el generador de rutas (capacidad del camión). 0 = sin peso
    // resuelto (producto sin match o SKU sin weightKg en el warehouse).
    weight: computed.weightKg,
    // Items con el peso YA resuelto por producto (empaques × peso por empaque). Se guarda
    // el desglose para verlo en el detalle del pedido cuando lleva varios productos.
    items: (Array.isArray(computed.items) && computed.items.length
      ? computed.items
      : (Array.isArray(input.items) ? input.items : [])) as unknown as Prisma.InputJsonValue,
    /**
     * Los nombres de los productos, en texto, para poder buscarlos.
     *
     * Es una copia de lo que va en `items`: dentro de un JSON no se puede buscar sin
     * leerse el catálogo entero.
     */
    productosTexto: (Array.isArray(computed.items) && computed.items.length
      ? computed.items
      : (Array.isArray(input.items) ? input.items : []))
      .map((i) => (i as { name?: string; description?: string }).name
        ?? (i as { description?: string }).description ?? '')
      .filter(Boolean)
      .join(' · ') || null,
    notes: input.notes || null,
    // Un pedido SIN domicilio no lleva costo: se importa igual (hace falta para las rutas y
    // la capacidad del camión) pero con el precio en NULL, no en 0 ni con la base.
    deliveryPrice: input.requiereDomicilio === false ? null : computed.quote.price,
    deliveryDistanceKm: computed.distanceKm,
    branchId: branch.id,
    source: 'pedido',
    // La fecha del pedido EN PEDIDO. `createdAt` es cuándo lo copió el espejo, y por eso
    // filtrar el día del armador de rutas por `createdAt` daba cero en cualquier día que
    // no fuera hoy: el espejo trae quince días de una vez y todos nacen con la de hoy.
    orderDate: input.orderDate ? new Date(input.orderDate) : null,
    // La marca de agua del espejo y los campos por los que se filtra. Ver OrderQuoteInput.
    pedidoUpdatedAt: input.pedidoUpdatedAt ? new Date(input.pedidoUpdatedAt) : null,
    estado: input.estado ?? null,
    archivado: input.archivado === true,
    fechaComprometida: input.fechaComprometida ? new Date(input.fechaComprometida) : null,
    requiereDomicilio: input.requiereDomicilio ?? null,
    pedidoCosto: input.pedidoCosto ?? null,
    facturaEstado: input.facturaEstado ?? null,
    facturaNumero: input.facturaNumero ?? null,
    facturaAt: input.facturaAt ? new Date(input.facturaAt) : null,
    facturaDomicilio: input.facturaDomicilio ?? null,
    facturaCorregidoAt: input.facturaCorregidoAt ? new Date(input.facturaCorregidoAt) : null,
    municipio: input.municipio ?? null,
    vendedor: input.vendedor ?? null,
    sucursalCodigo: input.sucursalCodigo ?? null,
    externalId: input.externalId || input.operationNumber || null,
    customerPhone: input.phone || null,
    // Guarda TODO el payload del pedido/cliente sin perder nada.
    ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
    userId: branch.creatorId,
  }
}
