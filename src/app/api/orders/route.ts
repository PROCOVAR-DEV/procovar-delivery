import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const orders = await prisma.order.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
    include: {
      route: {
        select: {
          id: true,
          name: true,
          routeCode: true,
          status: true,
          deliveryDate: true,
          vehicle: { select: { name: true, plate: true } },
        },
      },
      // Almacén de origen (punto de partida) para dibujar el recorrido en el detalle.
      branch: { select: { id: true, name: true, lat: true, lng: true } },
    }
  })

  // La lista muestra `price`; el costo de domicilio se guarda en `deliveryPrice`.
  // Exponerlo como `price`, y el `municipio` del cliente (viene en meta) para filtrar.
  const withPrice = orders.map((o) => ({
    ...o,
    price: o.deliveryPrice ?? null,
    municipio: ((o.meta as { cliente?: { municipio?: string } } | null)?.cliente?.municipio) || null,
  }))
  return NextResponse.json(withPrice)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    operationNumber,
    customerName,
    address,
    endAddress,
    endLat,
    endLng,
    lat,
    lng,
    weight,
    notes,
  } = await req.json()

  if (!customerName || !address) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const order = await prisma.order.create({
    data: {
      operationNumber: operationNumber || null,
      customerName,
      address,
      endAddress: endAddress || null,
      endLat: endLat ?? null,
      endLng: endLng ?? null,
      lat: lat ?? endLat ?? null,
      lng: lng ?? endLng ?? null,
      weight: weight || 1,
      notes: notes || null,
      userId: user.id as string,
    },
    include: {
      route: { select: { id: true, name: true } },
    }
  })

  return NextResponse.json(order, { status: 201 })
}

