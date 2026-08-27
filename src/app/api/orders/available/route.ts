import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * GET /api/orders/available — Pedidos YA importados de PEDIDO que están listos para
 * meter en una ruta: son de origen `pedido`, tienen geolocalización y todavía NO están
 * en ninguna ruta. El armador de rutas los lista para SELECCIONARLOS (no re-teclearlos):
 * ya traen su ubicación, su peso y su costo de domicilio calculado.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const q = params.get('q')?.trim().toLowerCase() || ''

  /**
   * Filtros por sucursal y por día, para armar una ruta.
   *
   * Una ruta se hace con los pedidos de UNA sucursal y de UN día. Sin poder acotar por
   * eso hay que buscarlos a ojo entre miles, que es lo que hacía la pantalla inservible
   * aunque el servidor conteste rápido.
   *
   * La sucursal pedida se aplica ADEMÁS del alcance, nunca en su lugar: quien sólo ve
   * una sucursal no puede pedir los pedidos de otra pasando el parámetro a mano.
   */
  const branchId = params.get('branchId')?.trim() || ''
  const fecha = params.get('fecha')?.trim() || ''

  const scope = await resolveScope(req, user)
  const alcance = scopeWhere(scope)

  let porDia: { gte: Date; lt: Date } | undefined

  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const desde = new Date(`${fecha}T00:00:00`)
    const hasta = new Date(desde)

    hasta.setDate(hasta.getDate() + 1)
    // Un día entero, de medianoche a medianoche. Comparar sólo la fecha dejaría fuera
    // todo lo que no cayera exactamente a las 00:00.
    porDia = { gte: desde, lt: hasta }
  }

  const orders = await prisma.order.findMany({
    where: {
      ...alcance,
      // Si ya hay alcance, la sucursal pedida sólo puede estrecharlo, no ampliarlo.
      ...(branchId && (!alcance.branchId || alcance.branchId === branchId)
        ? { branchId }
        : {}),
      ...(porDia ? { createdAt: porDia } : {}),
      source: 'pedido',
      routeId: null,
      endLat: { not: null },
      endLng: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      operationNumber: true,
      customerName: true,
      address: true,
      endAddress: true,
      endLat: true,
      endLng: true,
      weight: true,
      deliveryPrice: true,
      deliveryDistanceKm: true,
      items: true,
      meta: true,
    },
  })

  /**
   * El municipio y el VENDEDOR salen de `meta`, que guarda el pedido tal como llegó.
   *
   * El vendedor ya viaja en el payload de PEDIDO y aquí se estaba ignorando. Es uno de
   * los filtros que más falta hacen: una ruta se suele armar con los clientes de un
   * vendedor, porque son los que caen cerca unos de otros.
   */
  const conExtras = orders.map((o) => {
    const { meta, ...rest } = o
    const m = meta as { cliente?: { municipio?: string }; vendedor?: { nombre?: string; codigo?: string } } | null

    return {
      ...rest,
      municipio: m?.cliente?.municipio || null,
      vendedor: m?.vendedor?.nombre || m?.vendedor?.codigo || null,
    }
  })

  /**
   * Filtros para acotar qué pedidos entran en la ruta.
   *
   * Con miles en la lista, elegir a ojo es el trabajo de verdad. Cada uno responde a una
   * pregunta que se hace al armar una ruta: de quién son, dónde caen, cuánto pesan y si
   * el domicilio compensa el viaje.
   */
  const vendedor = params.get('vendedor')?.trim().toLowerCase() || ''
  /**
   * Convierte a número SÓLO si venía algo. `Number(null)` es 0, no NaN.
   *
   * Ese cero se colaba como "distancia máxima 0 km" cuando el filtro ni siquiera se
   * había usado, y descartaba todos los pedidos que tuvieran alguna distancia medida:
   * la lista salía vacía sin que nadie hubiera filtrado nada. Con un filtro puesto sí
   * funcionaba, que es lo que lo hacía difícil de ver — parecía que los filtros iban
   * bien y que lo roto era la lista.
   */
  const numero = (v: string | null) => {
    if (v == null || v.trim() === '') return null

    const n = Number(v)

    return Number.isFinite(n) ? n : null
  }
  const kmMax = numero(params.get('kmMax'))
  const costoMin = numero(params.get('costoMin'))

  const filtered = conExtras.filter((o) => {
    if (q) {
      // Una sola caja que busca por folio, cliente, dirección y municipio: quien la usa
      // no se para a pensar en qué campo está lo que recuerda.
      const cuadra =
        o.customerName.toLowerCase().includes(q) ||
        (o.endAddress || o.address || '').toLowerCase().includes(q) ||
        (o.operationNumber || '').toLowerCase().includes(q) ||
        (o.municipio || '').toLowerCase().includes(q) ||
        (o.vendedor || '').toLowerCase().includes(q)

      if (!cuadra) return false
    }
    if (vendedor && (o.vendedor || '').toLowerCase() !== vendedor) return false
    // Sin distancia medida no se descarta por distancia: no saberla no es estar lejos.
    if (kmMax != null && o.deliveryDistanceKm != null && o.deliveryDistanceKm > kmMax) return false
    if (costoMin != null && (o.deliveryPrice ?? 0) < costoMin) return false

    return true
  })

  return NextResponse.json(filtered)
}
