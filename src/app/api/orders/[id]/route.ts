import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findFirst({
    // Por sucursal, no por cuenta: un pedido es de la sucursal que lo originó,
    // así que lo abre cualquiera de esa sucursal — no solo quien lo creó (que
    // en los que entran desde PEDIDO no es nadie en concreto).
    where: { id, ...scopeWhere(await resolveScope(req, user)) },
    include: {
      route: { select: { id: true, name: true } },
      vehicle: { select: { id: true, name: true, type: true, plate: true } },
    }
  })

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(order)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const order = await prisma.order.findFirst({
    where: { id, ...scopeWhere(await resolveScope(req, user)) }
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.order.update({
    where: { id },
    data: {
      ...(data.operationNumber !== undefined && { operationNumber: data.operationNumber }),
      ...(data.customerName !== undefined && { customerName: data.customerName }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.endAddress !== undefined && { endAddress: data.endAddress }),
      ...(data.endLat !== undefined && { endLat: data.endLat }),
      ...(data.endLng !== undefined && { endLng: data.endLng }),
      ...(data.lat !== undefined && { lat: data.lat }),
      ...(data.lng !== undefined && { lng: data.lng }),
      ...(data.weight !== undefined && { weight: data.weight }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.tripLeg !== undefined && { tripLeg: data.tripLeg }),
      ...(data.routeId !== undefined && { routeId: data.routeId }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.stopOrder !== undefined && { stopOrder: data.stopOrder }),
      ...(data.status === 'delivered' && { deliveredAt: new Date() }),
    },
    include: {
      route: { select: { id: true, name: true } },
    }
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findFirst({
    where: { id, ...scopeWhere(await resolveScope(req, user)) }
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.order.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

