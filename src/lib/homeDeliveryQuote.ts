import { Prisma } from '@prisma/client'
import { haversineDistance, calculateHomeDeliveryPrice, HomeDeliveryQuote } from './pricing'

export interface QuoteItem {
  description?: string
  name?: string
  sku?: string
  code?: string
  weight?: number
  quantity?: number
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
  // Payload completo (cliente + pedido) tal como llega de PEDIDO, para guardarlo íntegro.
  meta?: unknown
}

/**
 * Peso total a partir de items (peso × cantidad); cae al fallback si no hay.
 * Si el item no trae `weight` pero sí `sku`/`code`, lo resuelve del catálogo de
 * pesos del Data Warehouse (weightMap: SKU en mayúsculas -> kg por unidad).
 */
export function weightFromItems(
  items: QuoteItem[] | undefined,
  fallback: number,
  weightMap?: Map<string, number>,
): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 0
  let w = 0
  for (const it of items) {
    const qty = Number(it.quantity) || 1
    let unitW = Number(it.weight) || 0
    if (!unitW && weightMap) {
      const sku = (it.sku || it.code || '').toString().toUpperCase()
      if (sku && weightMap.has(sku)) unitW = weightMap.get(sku) as number
    }
    w += unitW * qty
  }
  return w > 0 ? w : (fallback || 0)
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
}

/**
 * Cálculo puro del precio de domicilio de UN pedido, dada la sucursal-origen y la
 * config. No toca la base de datos. Reutilizado por `/api/quote` y el batch.
 */
export function computeOrderQuote(
  input: OrderQuoteInput,
  branch: BranchOrigin,
  settings: DomSettings,
  weightMap?: Map<string, number>,
): OrderQuoteResult {
  const weightKg = weightFromItems(input.items, Number(input.weight) || 0, weightMap)
  const distanceKm = haversineDistance(branch.lat, branch.lng, input.lat as number, input.lng as number)
  const quote = calculateHomeDeliveryPrice(distanceKm, weightKg, {
    domBaseFee: settings.domBaseFee,
    domCostPerKm: settings.domCostPerKm,
    domCostPerKg: settings.domCostPerKg,
    domIncludedKm: settings.domIncludedKm,
    domMinFee: settings.domMinFee,
    domRoundTo: settings.domRoundTo,
  })
  return { weightKg, distanceKm, quote }
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
    weight: computed.weightKg || 1,
    items: (Array.isArray(input.items) ? input.items : []) as unknown as Prisma.InputJsonValue,
    notes: input.notes || null,
    deliveryPrice: computed.quote.price,
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
