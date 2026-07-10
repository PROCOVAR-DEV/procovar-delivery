import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import {
  OrderQuoteInput,
  weightFromItems,
  buildOrderData,
  BranchOrigin,
} from '@/lib/homeDeliveryQuote'
import { haversineDistance, calculateDomicilioOficial } from '@/lib/pricing'
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

  // Vehículo de REFERENCIA por sucursal (el marcado `usarParaDomicilio`, del dueño de la
  // sucursal). Define capacidad + costo_km para el CKK de la fórmula del jefe. Cache por
  // creatorId de la sucursal.
  type RefVehiculo = { costoKmUsd: number; capacidadKg: number } | null
  const vehiculoCache = new Map<string, RefVehiculo>()
  async function getVehiculoRef(creatorId: string): Promise<RefVehiculo> {
    if (vehiculoCache.has(creatorId)) return vehiculoCache.get(creatorId) as RefVehiculo
    const vs = await prisma.vehicle.findMany({
      where: { userId: creatorId, costoKmUsd: { not: null }, capacity: { gt: 0 } },
      select: { costoKmUsd: true, capacity: true, usarParaDomicilio: true },
    })
    // Decisión del jefe: UN solo CKK para todos los repartos, el MAYOR de la flota
    // (curarse en salud). CKK ∝ costoKmUsd / capacidad. Un vehículo marcado
    // `usarParaDomicilio` actúa como override manual y gana.
    const override = vs.find((v) => v.usarParaDomicilio && v.costoKmUsd != null)
    let best: RefVehiculo = override ? { costoKmUsd: override.costoKmUsd as number, capacidadKg: override.capacity } : null
    if (!best) {
      let bestCkk = -1
      for (const v of vs) {
        if (v.costoKmUsd == null) continue
        const ckk = v.costoKmUsd / v.capacity
        if (ckk > bestCkk) { bestCkk = ckk; best = { costoKmUsd: v.costoKmUsd, capacidadKg: v.capacity } }
      }
    }
    vehiculoCache.set(creatorId, best)
    return best
  }

  const tc = settings.domTipoCambio || 700
  const results: Array<Record<string, unknown>> = []
  let quoted = 0
  let persisted = 0
  let skipped = 0

  // FÓRMULA OFICIAL (William) por pedido:  C = CKK × D × PP.
  // CKK = costo_km · tc / (0.5 · capacidad)  (del vehículo de referencia de la sucursal).
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
    // Vehículo de referencia de la sucursal (para el CKK). Sin él, no se calcula: espera.
    const veh = await getVehiculoRef(branch.creatorId)
    if (!veh) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-sin-vehiculo-de-calculo' })
      continue
    }

    const weightKg = weightFromItems(input.items, Number(input.weight) || 0, catalog)
    const distanceKm = haversineDistance(branch.lat, branch.lng, input.lat as number, input.lng as number)
    const dom = calculateDomicilioOficial(distanceKm, weightKg, veh.costoKmUsd, veh.capacidadKg, tc, settings.domMinFee || 0)
    const price = dom.usd // se guarda en USD (base); el front convierte a CUP con la tasa
    quoted++

    const base = {
      ref,
      status: 'quoted' as const,
      price,
      priceCup: dom.cup,
      distanceKm,
      weightKg,
      ckk: dom.ckk,
      branch: { id: branch.id, name: branch.name },
    }

    if (preview) {
      results.push(base)
      continue
    }

    // Persistir (idempotente por source+externalId). Requiere nombre de cliente.
    if (!input.customerName) {
      results.push({ ...base, persisted: false, reason: 'falta-customerName' })
      continue
    }
    const computed = {
      weightKg,
      distanceKm,
      quote: {
        price, distanceKm, chargeableKm: 0, weightKg,
        breakdown: { base: 0, distance: 0, weight: 0, beforeMin: price, beforeRound: price },
      },
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
