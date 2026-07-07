import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import {
  OrderQuoteInput,
  computeOrderQuote,
  buildOrderData,
  BranchOrigin,
} from '@/lib/homeDeliveryQuote'
import { fetchWeightMap } from '@/lib/warehouse'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quote/batch — Calcula el precio de domicilio de MUCHOS pedidos de una
 * vez (los que ya tenemos extraídos de PEDIDO). Auth: header `x-api-key`.
 *
 * Body: { preview?: boolean, orders: OrderQuoteInput[] }
 *
 * Regla clave: el cálculo se hace SOLO si el pedido trae geolocalización del
 * cliente (lat/lng). Si no la trae, ese pedido se SALTA (no es error) y se
 * reporta como `skipped` con su razón. Igual si su sucursal no está mapeada.
 */
export async function POST(req: NextRequest) {
  if (!isValidServiceKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.orders)) {
    return NextResponse.json({ error: 'Se espera { orders: [...] }' }, { status: 400 })
  }

  const preview: boolean = !!body.preview
  const orders: OrderQuoteInput[] = body.orders

  // Config de pricing (una sola vez).
  let settings = await prisma.settings.findFirst()
  if (!settings) settings = await prisma.settings.create({ data: {} })

  // Pesos por SKU desde el Data Warehouse (una sola vez). Best-effort: si el
  // warehouse/VPN no responde, se sigue sin pesos (peso 0 / lo que traiga el item).
  let weightMap: Map<string, number> | undefined
  let weightsSource: 'warehouse' | 'none' = 'none'
  if (body.useWarehouseWeights !== false) {
    try {
      weightMap = await fetchWeightMap()
      weightsSource = 'warehouse'
    } catch {
      weightMap = undefined
    }
  }

  // Cache de sucursales-origen por externalId (evita N consultas repetidas).
  const branchCache = new Map<string, BranchOrigin | null>()
  async function getBranch(externalId?: string): Promise<BranchOrigin | null> {
    if (!externalId) return null
    if (branchCache.has(externalId)) return branchCache.get(externalId) as BranchOrigin | null
    const b = await prisma.branch.findUnique({ where: { externalId } })
    const origin: BranchOrigin | null = b
      ? { id: b.id, name: b.name, lat: b.lat, lng: b.lng, creatorId: b.creatorId }
      : null
    branchCache.set(externalId, origin)
    return origin
  }

  const results: Array<Record<string, unknown>> = []
  let quoted = 0
  let persisted = 0
  let skipped = 0

  for (const input of orders) {
    const ref = input.externalId || input.operationNumber || null

    // 1) Sin geolocalización → no se puede calcular; se salta (no es error).
    if (input.lat == null || input.lng == null) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sin-geolocalizacion' })
      continue
    }

    // 2) Sucursal de origen no mapeada en delivery → se salta.
    const branch = await getBranch(input.sucursalExternalId)
    if (!branch) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-no-mapeada' })
      continue
    }

    // 3) Cálculo (peso resuelto por SKU si hay catálogo del warehouse).
    const computed = computeOrderQuote(input, branch, settings, weightMap)
    quoted++

    const base = {
      ref,
      status: 'quoted' as const,
      price: computed.quote.price,
      distanceKm: computed.distanceKm,
      chargeableKm: computed.quote.chargeableKm,
      weightKg: computed.quote.weightKg,
      branch: { id: branch.id, name: branch.name },
    }

    if (preview) {
      results.push(base)
      continue
    }

    // 4) Persistir (idempotente por source+externalId). Requiere nombre de cliente.
    if (!input.customerName) {
      results.push({ ...base, persisted: false, reason: 'falta-customerName' })
      continue
    }
    const data = buildOrderData(input, branch, computed)
    const existing = data.externalId
      ? await prisma.order.findFirst({ where: { source: 'pedido', externalId: data.externalId } })
      : null
    const order = existing
      ? await prisma.order.update({ where: { id: existing.id }, data })
      : await prisma.order.create({ data })
    persisted++
    results.push({ ...base, orderId: order.id, persisted: true })
  }

  return NextResponse.json({
    total: orders.length,
    quoted,
    persisted,
    skipped,
    weightsSource,
    currency: settings.currency,
    results,
  })
}
