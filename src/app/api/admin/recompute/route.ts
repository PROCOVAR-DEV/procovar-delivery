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

  /**
   * Los pedidos de los últimos días, y se dice cuántos días.
   *
   * Aquí había dos mentiras. Pedía `soloDomicilio=1&conCosto=1`, de cuando el espejo
   * también los pedía: con el catálogo completo eso recalculaba 206 de 50.683 y decía que
   * había terminado. Y no ponía `limit`, así que se llevaba el tope de PEDIDO —2.000— y
   * lo llamaba "todos los pedidos".
   *
   * Recalcular 50.000 pedidos no cabe en una petición HTTP: para eso está el worker
   * (`node sync-queue.mjs --recompute`), que recorre el año por tramos. Lo que sí cabe, y
   * es lo que se hace desde aquí, es lo reciente — que es lo que se quiere ver cambiado
   * después de tocar la fórmula—. Y se devuelve el número de días para que la pantalla lo
   * diga en vez de prometer el catálogo entero.
   */
  const DIAS_POR_DEFECTO = 30
  const pedidosDias = Number(new URL(req.url).searchParams.get('dias')) || DIAS_POR_DEFECTO
  const dias = Math.min(Math.max(1, pedidosDias), 120)

  const q = new URLSearchParams()
  const desde = new Date(Date.now() - dias * 86400000)

  q.set('desde', desde.toISOString().slice(0, 10))
  q.set('limit', '5000')
  if (sucursalCodigo) q.set('sucursalCodigo', sucursalCodigo)
  const pedRes = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY }, cache: 'no-store' })
  if (!pedRes.ok) {
    return NextResponse.json({ error: `PEDIDO ${pedRes.status}: ${(await pedRes.text().catch(() => '')).slice(0, 200)}` }, { status: 502 })
  }
  const { orders = [] } = await pedRes.json()
  if (orders.length === 0) {
    return NextResponse.json({
      total: 0,
      recosteados: 0,
      dias,
      message: `No hay pedidos con geolocalización en los últimos ${dias} días.`,
    })
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
        // El peso viene resuelto de PEDIDO (ver homeDeliveryQuote): no se vuelve a cruzar.
        items: (((pedido.items as Record<string, unknown>[]) || []).map((it) => ({
          code: it.codigo, name: it.producto, quantity: (it.unidades as number) || 1, packs: it.packs, descripcion: it.descripcion,
          pesoKg: it.pesoKg ?? null, pesoLineaKg: it.pesoLineaKg ?? null,
        }))),
        operationNumber: pedido.folio,
        externalId: pedido.id,
        orderDate: (pedido.fecha as string) ?? null,
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

  // 3) Contar lo recosteado. Antes esto lo escribía en PEDIDO; ya no.
  //
  // El costo del domicilio lo pone la APK. Que delivery lo reescribiera desde aquí
  // significaba que un botón de administración podía pisar, en silencio y de golpe, el
  // precio de todos los pedidos que la APK ya había cotizado.
  let recosteados = 0
  for (const o of orders as Array<{ id: string }>) {
    const r = byRef.get(o.id)
    if (r && r.status === 'quoted' && r.price != null) recosteados++
  }

  return NextResponse.json({
    total: orders.length,
    recosteados,
    // La pantalla lo enseña: un "recalculados 2.000" sin decir de cuándo se lee como
    // "recalculado todo", y no lo es.
    dias,
    // "actualizados" era cuántos se escribieron en PEDIDO. Ya no se escribe ninguno, así
    // que el campo se va en vez de quedarse informando un cero que se leería como un fallo.
    weightsSource: quoteJson.weightsSource,
    sucursal: sucursalCodigo || 'todas',
  })
}
