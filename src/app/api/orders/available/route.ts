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

  const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''

  const scope = await resolveScope(req, user)
  const orders = await prisma.order.findMany({
    where: {
      ...scopeWhere(scope),
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
