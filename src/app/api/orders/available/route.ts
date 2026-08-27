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

  // Expone el municipio (del cliente, viene en meta) para poder filtrar por él.
  const conMunicipio = orders.map((o) => {
    const { meta, ...rest } = o
    return { ...rest, municipio: ((meta as { cliente?: { municipio?: string } } | null)?.cliente?.municipio) || null }
  })

  const filtered = q
    ? conMunicipio.filter((o) =>
        o.customerName.toLowerCase().includes(q) ||
        (o.endAddress || o.address || '').toLowerCase().includes(q) ||
        (o.operationNumber || '').toLowerCase().includes(q) ||
        (o.municipio || '').toLowerCase().includes(q))
    : conMunicipio

  return NextResponse.json(filtered)
}
