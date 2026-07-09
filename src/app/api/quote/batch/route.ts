import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import {
  OrderQuoteInput,
  weightFromItems,
  buildOrderData,
  BranchOrigin,
} from '@/lib/homeDeliveryQuote'
import { haversineDistance, calculateShareDeliveryPrice } from '@/lib/pricing'
import { fetchWeightCatalog } from '@/lib/warehouse'
import type { WeightCatalog } from '@/lib/productMatch'

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

  // Catálogo de pesos del Data Warehouse (una sola vez). Best-effort: si el warehouse/VPN
  // no responde, se sigue sin pesos (peso 0). Los pedidos no traen SKU, así que el match
  // es por nombre normalizado (+ fuzzy) contra el catálogo. Ver productMatch.ts.
  let catalog: WeightCatalog | undefined
  let weightsSource: 'warehouse' | 'none' = 'none'
  if (body.useWarehouseWeights !== false) {
    try {
      catalog = await fetchWeightCatalog()
      weightsSource = 'warehouse'
    } catch {
      catalog = undefined
    }
  }

  // Cache del almacén-origen por externalId (evita N consultas repetidas). Guarda si
  // existe y si tiene el PUNTO DE PARTIDA configurado (cada sucursal el suyo).
  type BranchInfo = { origin: BranchOrigin; configured: boolean } | null
  const branchCache = new Map<string, BranchInfo>()
  async function getBranch(externalId?: string): Promise<BranchInfo> {
    if (!externalId) return null
    if (branchCache.has(externalId)) return branchCache.get(externalId) as BranchInfo
    const b = await prisma.branch.findUnique({ where: { externalId } })
    const info: BranchInfo = b
      ? {
          origin: { id: b.id, name: b.name, lat: b.lat, lng: b.lng, creatorId: b.creatorId },
          configured: b.originConfigured,
        }
      : null
    branchCache.set(externalId, info)
    return info
  }

  const results: Array<Record<string, unknown>> = []
  let quoted = 0
  let persisted = 0
  let skipped = 0

  // PASO 1: validar cada pedido y calcular su PESO (total de sus productos) y su
  // DISTANCIA al almacén. Se acumula el PESO DE CARGA por sucursal = suma del peso de
  // los pedidos cotizables de esa sucursal en ESTE envío. El precio se sabe recién en
  // el paso 2 (necesita la carga total: cada pedido paga su fracción de peso).
  type Prepared = {
    input: OrderQuoteInput
    ref: string | null
    branch: BranchOrigin
    weightKg: number
    distanceKm: number
  }
  const prepared: Prepared[] = []
  const pesoCargaByBranch = new Map<string, number>()

  for (const input of orders) {
    const ref = input.externalId || input.operationNumber || null

    // Sin geolocalización → no se puede calcular; se salta (no es error).
    if (input.lat == null || input.lng == null) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sin-geolocalizacion' })
      continue
    }
    // La sucursal de origen debe existir en delivery Y tener su punto de partida.
    const info = await getBranch(input.sucursalExternalId)
    if (!info) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-no-mapeada' })
      continue
    }
    if (!info.configured) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-sin-punto-de-partida' })
      continue
    }
    const branch = info.origin
    const weightKg = weightFromItems(input.items, Number(input.weight) || 0, catalog)
    const distanceKm = haversineDistance(branch.lat, branch.lng, input.lat as number, input.lng as number)
    prepared.push({ input, ref, branch, weightKg, distanceKm })
    pesoCargaByBranch.set(branch.id, (pesoCargaByBranch.get(branch.id) || 0) + weightKg)
  }

  // PASO 2: precio = 2·dist·peso·costo_km / peso_carga_de_su_sucursal, y persistir.
  for (const p of prepared) {
    const pesoCarga = pesoCargaByBranch.get(p.branch.id) || 0
    const price = calculateShareDeliveryPrice(p.distanceKm, p.weightKg, settings.domCostPerKm, pesoCarga)
    quoted++

    const base = {
      ref: p.ref,
      status: 'quoted' as const,
      price,
      distanceKm: p.distanceKm,
      weightKg: p.weightKg,
      pesoCarga,
      branch: { id: p.branch.id, name: p.branch.name },
    }

    if (preview) {
      results.push(base)
      continue
    }

    // Persistir (idempotente por source+externalId). Requiere nombre de cliente.
    if (!p.input.customerName) {
      results.push({ ...base, persisted: false, reason: 'falta-customerName' })
      continue
    }
    const computed = {
      weightKg: p.weightKg,
      distanceKm: p.distanceKm,
      quote: {
        price, distanceKm: p.distanceKm, chargeableKm: 0, weightKg: p.weightKg,
        breakdown: { base: 0, distance: 0, weight: 0, beforeMin: price, beforeRound: price },
      },
    }
    const data = buildOrderData(p.input, p.branch, computed)
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
