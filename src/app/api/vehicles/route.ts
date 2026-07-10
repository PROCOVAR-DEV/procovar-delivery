import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vehicles = await prisma.vehicle.findMany({
    where: { userId: user.id as string },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { routes: true, orders: true, orderAssignments: true } },
      routes: {
        where: { status: { not: 'completed' } },
        select: { id: true, name: true, status: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      }
    }
  })

  return NextResponse.json(vehicles)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, type, plate, capacity, status, notes, costoKmUsd, usarParaDomicilio } = await req.json()

  if (!name) {
    return NextResponse.json({ error: 'Vehicle name is required' }, { status: 400 })
  }

  const userId = user.id as string
  const useForDelivery = usarParaDomicilio === true
  const vehicleType = type || 'truck'

  const vehicle = await prisma.$transaction(async (tx) => {
    // Solo UN vehículo por TIPO puede ser la referencia de cálculo del domicilio.
    if (useForDelivery) {
      await tx.vehicle.updateMany({
        where: { userId, type: vehicleType, usarParaDomicilio: true },
        data: { usarParaDomicilio: false },
      })
    }
    return tx.vehicle.create({
      data: {
        name,
        type: vehicleType,
        plate: plate || null,
        capacity: capacity ?? 1000,
        status: status || 'available',
        notes: notes || null,
        costoKmUsd: costoKmUsd === undefined ? null : costoKmUsd,
        usarParaDomicilio: useForDelivery,
        userId,
      }
    })
  })

  return NextResponse.json(vehicle, { status: 201 })
}
