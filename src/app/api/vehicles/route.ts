import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const vehicles = await prisma.vehicle.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { routes: true, orders: true, orderAssignments: true } },
      routes: {
        where: { status: { not: 'completed' } },
        // El CÓDIGO también: una ruta puede no tener nombre —es opcional al crearla— y
        // sin él la tarjeta del vehículo pintaba un hueco donde debía decir cuál lleva.
        select: { id: true, name: true, routeCode: true, status: true },
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

  const scope = await resolveScope(req, user)
  const userId = scope.actorId
  const branchId = scope.branchId // sucursal del usuario o la elegida por el admin
  const useForDelivery = usarParaDomicilio === true
  const vehicleType = type || 'truck'

  const vehicle = await prisma.$transaction(async (tx) => {
    /**
     * Un vehículo de referencia por TIPO y por SUCURSAL, no por persona.
     *
     * Estaba acotado por `userId`, y eso significa que cada administrador tendría el
     * suyo: dos personas de la misma sucursal marcan cada una un camión distinto como
     * referencia, ninguna desmarca la de la otra, y el domicilio sale a un precio u otro
     * según quién lo calcule. Nada avisa — los dos números son plausibles.
     *
     * El vehículo pertenece a la sucursal, así que la exclusividad es de la sucursal.
     */
    if (useForDelivery) {
      await tx.vehicle.updateMany({
        where: {
          type: vehicleType,
          usarParaDomicilio: true,
          ...(branchId ? { branchId } : {}),
        },
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
        ...(branchId ? { branchId } : {}),
      }
    })
  })

  return NextResponse.json(vehicle, { status: 201 })
}
