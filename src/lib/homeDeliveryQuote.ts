import { Prisma } from '@prisma/client'
import { haversineDistance, calculateHomeDeliveryPrice, HomeDeliveryQuote } from './pricing'
import type { WeightCatalog } from './productMatch'

export interface QuoteItem {
  description?: string
  name?: string
  sku?: string
  code?: string
  weight?: number
  quantity?: number
  packs?: number // nº de unidades de venta (blisters/cajas). El peso del warehouse es POR pack.
}

export interface OrderQuoteInput {
  sucursalExternalId?: string
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
  unitWeightKg: number   // peso por unidad de venta (pack) del warehouse (informativo).
  matched: boolean       // true si se resolvió el peso; false = producto sin match.
  whName?: string | null // nombre del producto en el warehouse con que emparejó.
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
    const manual = Number(it.weight) || 0
    if (manual > 0) {
      const line = manual * (Number(it.quantity) || 1)
      total += line
      return { ...it, weightKg: line, unitWeightKg: manual, matched: true, whName: null }
    }
    if (catalog) {
      const hit = catalog.resolve(it.name, it.sku || it.code)
      if (hit.weightKg > 0) {
        const packs = Number(it.packs) || 0
        const line = hit.weightKg * packs
        total += line
        return { ...it, weightKg: line, unitWeightKg: hit.weightKg, matched: true, whName: hit.whName ?? null }
      }
    }
    return { ...it, weightKg: 0, unitWeightKg: 0, matched: false, whName: null }
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

/** Config `dom*` que necesita el cálculo de domicilio. */
export interface DomSettings {
  domBaseFee: number
  domCostPerKm: number
  domCostPerKg: number
  domIncludedKm: number
  domMinFee: number
  domRoundTo: number
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
 * Cálculo puro del precio de domicilio de UN pedido, dada la sucursal-origen y la
 * config. No toca la base de datos. Reutilizado por `/api/quote` y el batch.
 */
export function computeOrderQuote(
  input: OrderQuoteInput,
  branch: BranchOrigin,
  settings: DomSettings,
  catalog?: WeightCatalog,
): OrderQuoteResult {
  const { total, items } = computeItemsWeights(input.items, catalog)
  const weightKg = total > 0 ? total : (Number(input.weight) || 0)
  const distanceKm = haversineDistance(branch.lat, branch.lng, input.lat as number, input.lng as number)
  const quote = calculateHomeDeliveryPrice(distanceKm, weightKg, {
    domBaseFee: settings.domBaseFee,
    domCostPerKm: settings.domCostPerKm,
    domCostPerKg: settings.domCostPerKg,
    domIncludedKm: settings.domIncludedKm,
    domMinFee: settings.domMinFee,
    domRoundTo: settings.domRoundTo,
  })
  return { weightKg, distanceKm, quote, items }
}

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
    notes: input.notes || null,
    // Un pedido SIN domicilio no lleva costo: se importa igual (hace falta para las rutas y
    // la capacidad del camión) pero con el precio en NULL, no en 0 ni con la base.
    deliveryPrice: input.requiereDomicilio === false ? null : computed.quote.price,
    deliveryDistanceKm: computed.distanceKm,
    branchId: branch.id,
    source: 'pedido',
    externalId: input.externalId || input.operationNumber || null,
    customerPhone: input.phone || null,
    // Guarda TODO el payload del pedido/cliente sin perder nada.
    ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
    userId: branch.creatorId,
  }
}
