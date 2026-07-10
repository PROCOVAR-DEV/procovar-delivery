import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, userId: user.id as string },
    include: {
      routes: { select: { id: true, name: true, status: true, createdAt: true } },
      _count: { select: { routes: true, orders: true, orderAssignments: true } }
    }
  })

  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(vehicle)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, userId: user.id as string }
  })
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updateData = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.type !== undefined && { type: data.type }),
    ...(data.plate !== undefined && { plate: data.plate }),
    ...(data.capacity !== undefined && { capacity: data.capacity }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.costoKmUsd !== undefined && { costoKmUsd: data.costoKmUsd }),
    ...(data.usarParaDomicilio !== undefined && { usarParaDomicilio: data.usarParaDomicilio === true }),
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Solo UN vehículo por TIPO puede ser la referencia de cálculo del domicilio.
    if (data.usarParaDomicilio === true) {
      const targetType = data.type !== undefined ? data.type : vehicle.type
      await tx.vehicle.updateMany({
        where: { userId: user.id as string, type: targetType, usarParaDomicilio: true, id: { not: id } },
        data: { usarParaDomicilio: false },
      })
    }
    return tx.vehicle.update({ where: { id }, data: updateData })
  })

  // When marking a vehicle as available, auto-complete its active route
  if (data.status === 'available' && vehicle.status === 'in_use') {
    await prisma.route.updateMany({
      where: { vehicleId: id, status: { not: 'completed' } },
      data: { status: 'completed' },
    })
  }

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, userId: user.id as string }
  })
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Unlink from routes and orders before deleting
  await prisma.route.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } })
  await prisma.order.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } })
  await prisma.orderVehicle.deleteMany({ where: { vehicleId: id } })

  await prisma.vehicle.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
