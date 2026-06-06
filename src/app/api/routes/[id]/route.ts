import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import {
  greedyRouteOptimization,
  calculateRouteSegments,
  calculateClientDistances,
  calculateOrderPrice,
  haversineDistance,
} from '@/lib/pricing'

export const dynamic = 'force-dynamic'

interface StopInput {
  customerName: string
  weight: number
  address: string
  lat: number
  lng: number
  operationNumber?: string | null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const route = await prisma.route.findFirst({
    where: { id, userId: user.id as string },
    include: {
      orders: { orderBy: { stopOrder: 'asc' } }
    }
  })

  if (!route) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json(route)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const route = await prisma.route.findFirst({
    where: { id, userId: user.id as string },
    include: { orders: { orderBy: { stopOrder: 'asc' } }, vehicle: true }
  })
  if (!route) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  // --- Vehicle assignment (auto-enable/disable) ---
  if (data.vehicleId !== undefined) {
    if (route.vehicleId && route.vehicleId !== data.vehicleId) {
      const oldVehicle = await prisma.vehicle.findFirst({ where: { id: route.vehicleId } })
      if (oldVehicle?.status === 'in_use') {
        await prisma.vehicle.update({ where: { id: route.vehicleId }, data: { status: 'available' } })
      }
    }
    if (data.vehicleId) {
      await prisma.vehicle.update({ where: { id: data.vehicleId }, data: { status: 'in_use' } })
    }
    const simpleUpdate = await prisma.route.update({
      where: { id },
      data: {
        vehicleId: data.vehicleId || null,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.status !== undefined && { status: data.status }),
      },
      include: { vehicle: { select: { id: true, name: true, type: true, plate: true, capacity: true } } }
    })
    return NextResponse.json(simpleUpdate)
  }

  // --- Add new client stops (inline order creation) with full re-optimization ---
  const newStops: StopInput[] = Array.isArray(data.stops) ? data.stops : []

  if (newStops.length > 0) {
    for (const s of newStops) {
      if (!s.customerName || s.lat == null || s.lng == null) {
        return NextResponse.json({ error: 'Cada pedido requiere nombre de cliente y ubicación' }, { status: 400 })
      }
    }

    let settings = await prisma.settings.findFirst()
    if (!settings) {
      settings = await prisma.settings.create({ data: { baseFee: 5.0, costPerKm: 1.5, costPerKg: 0.5 } })
    }
    const config = { baseFee: settings.baseFee, costPerKm: settings.costPerKm, costPerKg: settings.costPerKg }
    const origin = { lat: route.originLat ?? 0, lng: route.originLng ?? 0 }

    // Capacity validation (existing + new)
    if (route.vehicleId && route.vehicle) {
      const existingWeight = route.orders.reduce((sum, o) => sum + o.weight, 0)
      const newWeight = newStops.reduce((sum, s) => sum + (s.weight || 0), 0)
      const totalWeight = existingWeight + newWeight
      if (totalWeight > route.vehicle.capacity) {
        return NextResponse.json({
          error: `Peso total (${totalWeight.toFixed(1)} kg) supera la capacidad del vehículo (${route.vehicle.capacity} kg)`
        }, { status: 400 })
      }
    }

    // Create the new orders
    await Promise.all(
      newStops.map((s) =>
        prisma.order.create({
          data: {
            customerName: s.customerName,
            operationNumber: s.operationNumber || null,
            address: s.address || s.customerName,
            endAddress: s.address || null,
            endLat: s.lat,
            endLng: s.lng,
            lat: s.lat,
            lng: s.lng,
            weight: s.weight || 1,
            tripLeg: 'outbound',
            routeId: id,
            userId: user.id as string,
          }
        })
      )
    )

    // Re-optimize and re-price the full stop list
    const allOrders = await prisma.order.findMany({ where: { routeId: id } })
    const stopsForOpt = allOrders.map((o) => ({ id: o.id, lat: (o.endLat ?? o.lat)!, lng: (o.endLng ?? o.lng)! }))
    const optimizedIds =
      stopsForOpt.length > 1 ? greedyRouteOptimization(origin, stopsForOpt) : stopsForOpt.map((s) => s.id)

    const ordersMap = Object.fromEntries(allOrders.map((o) => [o.id, o]))
    const orderedStops = optimizedIds.map((oid) => {
      const o = ordersMap[oid]
      return { id: o.id, lat: (o.endLat ?? o.lat)!, lng: (o.endLng ?? o.lng)! }
    })

    const drivingSegments = calculateRouteSegments(origin, orderedStops)
    const clientDistances = calculateClientDistances(origin, orderedStops)

    let totalDistance = 0
    let totalWeight = 0
    let totalPrice = 0

    for (let i = 0; i < optimizedIds.length; i++) {
      const oid = optimizedIds[i]
      const order = ordersMap[oid]
      const segmentKm = clientDistances[i] ?? 0
      const price = calculateOrderPrice(segmentKm, order.weight, config)
      totalDistance += drivingSegments[i] ?? 0
      totalWeight += order.weight
      totalPrice += price

      await prisma.order.update({
        where: { id: oid },
        data: { stopOrder: i + 1, tripLeg: 'outbound', price, segmentKm }
      })
    }

    // Return leg back to depot
    if (orderedStops.length > 0) {
      const last = orderedStops[orderedStops.length - 1]
      totalDistance += haversineDistance(last.lat, last.lng, origin.lat, origin.lng)
    }

    const updated = await prisma.route.update({
      where: { id },
      data: {
        totalDistance,
        totalWeight,
        totalPrice,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.status !== undefined && { status: data.status }),
      }
    })
    return NextResponse.json(updated)
  }

  // --- Simple field updates ---
  // Completing a route frees its vehicle.
  if (data.status === 'completed' && route.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: route.vehicleId } })
    if (vehicle?.status === 'in_use') {
      await prisma.vehicle.update({ where: { id: route.vehicleId }, data: { status: 'available' } })
    }
  }

  const updated = await prisma.route.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.status !== undefined && { status: data.status }),
    }
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const route = await prisma.route.findFirst({
    where: { id, userId: user.id as string }
  })
  if (!route) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  if (route.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: route.vehicleId } })
    if (vehicle?.status === 'in_use') {
      await prisma.vehicle.update({ where: { id: route.vehicleId }, data: { status: 'available' } })
    }
  }

  // Orders were created for this route inline; remove them with the route.
  await prisma.order.deleteMany({ where: { routeId: id } })
  await prisma.route.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
