import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import { fetchWeightCatalog, invalidateWeightsCache } from '@/lib/warehouse'
import { weightFromItems, QuoteItem } from '@/lib/homeDeliveryQuote'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/recompute-weights — Recalcula el `weight` (kg) de los pedidos ya
 * guardados a partir de sus `items`, usando el catálogo actual del Data Warehouse
 * (match por nombre normalizado/fuzzy × packs). Útil para arreglar los que quedaron en
 * el default viejo (1 kg) y para re-correrlo cuando el warehouse llene más pesos.
 * Auth: header `x-api-key`. Body opcional: { source?: 'pedido', dryRun?: boolean }.
 *
 * Devuelve un resumen + la lista de nombres de producto que NO pudieron pesarse (sin
 * match o SKU sin weightKg), para saber qué falta cargar en el warehouse.
 */
export async function POST(req: NextRequest) {
  if (!isValidServiceKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const source = typeof body.source === 'string' ? (body.source as string) : 'pedido'
  const dryRun = body.dryRun === true

  let catalog
  try {
    // Recompute exige pesos FRESCOS (se corre justo cuando el warehouse llenó pesos):
    // invalida el cache para re-bajar el catálogo, no servir uno viejo.
    await invalidateWeightsCache()
    catalog = await fetchWeightCatalog()
  } catch (e) {
    return NextResponse.json({ error: 'No se pudo leer el catálogo del warehouse (¿VPN?): ' + (e as Error).message }, { status: 502 })
  }

  const orders = await prisma.order.findMany({
    where: { source },
    select: { id: true, items: true, weight: true },
  })

  let updated = 0
  let unchanged = 0
  let sinPeso = 0 // pedidos cuyo peso quedó en 0 (nada resuelto)
  const noMatch = new Map<string, number>() // nombre de producto -> veces que no se pudo pesar

  for (const o of orders) {
    const items = (Array.isArray(o.items) ? o.items : []) as unknown as QuoteItem[]
    const w = weightFromItems(items, 0, catalog)

    // Registrar productos que no aportaron peso (para el reporte).
    for (const it of items) {
      const manual = Number(it.weight) || 0
      if (manual > 0) continue
      const hit = catalog.resolve(it.name, it.sku || it.code)
      if (hit.weightKg <= 0) {
        const nm = (it.name || '(sin nombre)').trim()
        noMatch.set(nm, (noMatch.get(nm) || 0) + 1)
      }
    }

    if (w === 0) sinPeso++
    if (Math.abs(w - (o.weight || 0)) < 1e-6) { unchanged++; continue }
    if (!dryRun) await prisma.order.update({ where: { id: o.id }, data: { weight: w } })
    updated++
  }

  const productosSinPeso = [...noMatch.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, veces]) => ({ name, veces }))

  return NextResponse.json({
    dryRun,
    totalOrders: orders.length,
    updated,
    unchanged,
    ordersSinPeso: sinPeso,
    productosSinPeso,
  })
}
