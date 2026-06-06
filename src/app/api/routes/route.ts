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

async function generateRouteCode(): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `RT-${dateStr}-`

  const count = await prisma.route.count({
    where: { routeCode: { startsWith: prefix } },
  })

  const seq = String(count + 1).padStart(3, '0')
  return `${prefix}${seq}`
}

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const routes = await prisma.route.findMany({
    where: { userId: user.id as string },
    orderBy: { createdAt: 'desc' },
    include: {
      vehicle: { select: { id: true, name: true, type: true, plate: true, capacity: true } },
      orders: {
        orderBy: { stopOrder: 'asc' },
        select: {
          id: true,
          operationNumber: true,
          customerName: true,
          address: true,
          endAddress: true,
          endLat: true,
          endLng: true,
          status: true,
          weight: true,
          lat: true,
          lng: true,
          price: true,
          segmentKm: true,
          stopOrder: true,
          tripLeg: true,
        }
      }
    }
  })

  return NextResponse.json(routes)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    name,
    vehicleId,
    originAddress,
    originLat,
    originLng,
    stops = [],
  }: {
    name?: string
    vehicleId?: string
    originAddress?: string
    originLat?: number
    originLng?: number
    stops?: StopInput[]
  } = await req.json()

  if (originLat == null || originLng == null) {
    return NextResponse.json({ error: 'Las coordenadas del punto de partida son requeridas' }, { status: 400 })
  }

  if (!vehicleId) {
    return NextResponse.json({ error: 'Se requiere un vehículo para crear la ruta' }, { status: 400 })
  }

  if (!Array.isArray(stops) || stops.length === 0) {
    return NextResponse.json({ error: 'Se requiere al menos un pedido de cliente' }, { status: 400 })
  }

  // Validate each stop
  for (const s of stops) {
    if (!s.customerName || s.lat == null || s.lng == null) {
      return NextResponse.json({ error: 'Cada pedido requiere nombre de cliente y ubicación' }, { status: 400 })
    }
  }

  // Load global pricing settings
  let settings = await prisma.settings.findFirst()
  if (!settings) {
    settings = await prisma.settings.create({
      data: { baseFee: 5.0, costPerKm: 1.5, costPerKg: 0.5 }
    })
  }
  const config = {
    baseFee: settings.baseFee,
    costPerKm: settings.costPerKm,
    costPerKg: settings.costPerKg,
  }

  // Validate vehicle capacity against total stop weight
  const totalStopWeight = stops.reduce((sum, s) => sum + (s.weight || 0), 0)
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId } })
    if (vehicle && totalStopWeight > vehicle.capacity) {
      return NextResponse.json({
        error: `Peso total (${totalStopWeight.toFixed(1)} kg) supera la capacidad del vehículo (${vehicle.capacity} kg)`
      }, { status: 400 })
    }
  }

  const origin = { lat: originLat, lng: originLng }

  const routeCode = await generateRouteCode()

  const route = await prisma.route.create({
    data: {
      name: name || null,
      routeCode,
      userId: user.id as string,
      ...(vehicleId && { vehicleId }),
      originAddress: originAddress ?? null,
      originLat,
      originLng,
    }
  })

  // Create the orders inline from the stop inputs
  const createdOrders = await Promise.all(
    stops.map((s) =>
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
          routeId: route.id,
          userId: user.id as string,
        }
      })
    )
  )

  // Optimize visiting order from the depot
  const stopsForOpt = createdOrders.map((o) => ({ id: o.id, lat: o.endLat!, lng: o.endLng! }))
  const optimizedIds =
    stopsForOpt.length > 1 ? greedyRouteOptimization(origin, stopsForOpt) : stopsForOpt.map((s) => s.id)

  const ordersMap = Object.fromEntries(createdOrders.map((o) => [o.id, o]))
  const orderedStops = optimizedIds.map((id) => {
    const o = ordersMap[id]
    return { id: o.id, lat: o.endLat!, lng: o.endLng! }
  })

  // Real driving distance per consecutive segment (depot -> stop1 -> stop2 ...)
  const drivingSegments = calculateRouteSegments(origin, orderedStops)
  // Per-client distance from depot (for pricing, charged x2 for round trip)
  const clientDistances = calculateClientDistances(origin, orderedStops)

  let totalDistance = 0
  let totalWeight = 0
  let totalPrice = 0

  for (let i = 0; i < optimizedIds.length; i++) {
    const orderId = optimizedIds[i]
    const order = ordersMap[orderId]
    const segmentKm = clientDistances[i] ?? 0
    const price = calculateOrderPrice(segmentKm, order.weight, config)

    totalDistance += drivingSegments[i] ?? 0
    totalWeight += order.weight
    totalPrice += price

    await prisma.order.update({
      where: { id: orderId },
      data: { stopOrder: i + 1, price, segmentKm },
    })
  }

  // Return leg: truck drives back from the last stop to the depot.
  if (orderedStops.length > 0) {
    const last = orderedStops[orderedStops.length - 1]
    totalDistance += haversineDistance(last.lat, last.lng, origin.lat, origin.lng)
  }

  await prisma.route.update({
    where: { id: route.id },
    data: {
      totalDistance,
      totalWeight,
      totalPrice,
      optimized: true,
    }
  })

  if (vehicleId) {
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: 'in_use' },
    })
  }

  const fullRoute = await prisma.route.findUnique({
    where: { id: route.id },
    include: {
      vehicle: { select: { id: true, name: true, type: true, plate: true, capacity: true } },
      orders: { orderBy: { stopOrder: 'asc' } }
    }
  })

  return NextResponse.json(fullRoute, { status: 201 })
}
