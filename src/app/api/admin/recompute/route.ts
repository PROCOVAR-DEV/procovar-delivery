import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope } from '@/lib/scope'

export const dynamic = 'force-dynamic'
// El recálculo de TODOS los pedidos puede tardar; damos margen.
export const maxDuration = 300

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:8400'
const DELIVERY_URL = process.env.DELIVERY_URL || 'http://localhost:3002'
const KEY = process.env.SERVICE_API_KEY

/**
 * POST /api/admin/recompute — Recotiza TODOS los pedidos con la configuración VIGENTE
 * (fórmula, factor, mínimo, tarifa del vehículo, tasa CUP) y reescribe el costo de
 * domicilio en PEDIDO. Úsalo tras cambiar la configuración (ej. el costo mínimo).
 *
 * Alcance: un admin de sucursal recalcula SOLO su sucursal; el Super Admin, todas
 * (o la elegida en el selector, vía header x-sucursal-id).
 */
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!KEY) return NextResponse.json({ error: 'SERVICE_API_KEY no configurada en el servidor' }, { status: 500 })

  // La fórmula es global: sin ella no se calcula nada.
  const settings = await prisma.settings.findFirst({ select: { domConfigured: true } })
  if (!settings?.domConfigured) {
    return NextResponse.json({ error: 'Falta configurar la fórmula del domicilio (Configuración).' }, { status: 400 })
  }

  // Alcance por sucursal: se filtra por el CÓDIGO (externalId) de la sucursal.
  const scope = await resolveScope(req, user)
  let sucursalCodigo = ''
  if (scope.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: scope.branchId }, select: { externalId: true } })
    sucursalCodigo = b?.externalId || ''
  }

  // 1) Traer los pedidos con geolocalización de PEDIDO (todos, no solo pendientes).
  const q = new URLSearchParams()
  if (sucursalCodigo) q.set('sucursalCodigo', sucursalCodigo)
  const pedRes = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY }, cache: 'no-store' })
  if (!pedRes.ok) {
    return NextResponse.json({ error: `PEDIDO ${pedRes.status}: ${(await pedRes.text().catch(() => '')).slice(0, 200)}` }, { status: 502 })
  }
  const { orders = [] } = await pedRes.json()
  if (orders.length === 0) {
    return NextResponse.json({ total: 0, recosteados: 0, actualizados: 0, message: 'No hay pedidos con geolocalización para recalcular.' })
  }

  // 2) Recotizar TODO el lote (persiste los Order de delivery + peso por producto).
  const body = {
    orders: orders.map((pedido: Record<string, unknown>) => {
      const cliente = (pedido.cliente as Record<string, unknown>) || {}
      return {
        sucursalExternalId: pedido.sucursalCodigo,
        customerName: (cliente.nombre as string) || (pedido.encargado as string) || 'Cliente',
        address: (pedido.direccion as string) || (cliente.direccion as string) || null,
        phone: (pedido.telefono as string) || null,
        lat: (cliente.latitud as number) ?? null,
        lng: (cliente.longitud as number) ?? null,
        items: (((pedido.items as Record<string, unknown>[]) || []).map((it) => ({
          code: it.codigo, name: it.producto, quantity: (it.unidades as number) || 1, packs: it.packs, descripcion: it.descripcion,
        }))),
        operationNumber: pedido.folio,
        externalId: pedido.id,
        meta: pedido,
      }
    }),
  }
  const quoteRes = await fetch(`${DELIVERY_URL}/api/quote/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  })
  if (!quoteRes.ok) {
    return NextResponse.json({ error: `Cotización ${quoteRes.status}: ${(await quoteRes.text().catch(() => '')).slice(0, 200)}` }, { status: 502 })
  }
  const quoteJson = await quoteRes.json()
  const byRef = new Map<string, { status?: string; price?: number; distanceKm?: number }>()
  for (const r of (quoteJson.results || [])) if (r.ref != null) byRef.set(r.ref, r)

  // 3) Reescribir el costo en PEDIDO (en lotes).
  const updates: Array<{ id: string; costo: number; distanceKm?: number }> = []
  for (const o of orders as Array<{ id: string }>) {
    const r = byRef.get(o.id)
    if (r && r.status === 'quoted' && r.price != null) updates.push({ id: o.id, costo: r.price, distanceKm: r.distanceKm })
  }
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200)
    const wb = await fetch(`${PEDIDO_API_URL}/integration/orders/domicilio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ updates: chunk }),
    })
    if (!wb.ok) {
      return NextResponse.json({ error: `Escritura en PEDIDO ${wb.status}: ${(await wb.text().catch(() => '')).slice(0, 200)}` }, { status: 502 })
    }
  }

  return NextResponse.json({
    total: orders.length,
    recosteados: updates.length,
    actualizados: updates.length,
    weightsSource: quoteJson.weightsSource,
    sucursal: sucursalCodigo || 'todas',
  })
}
