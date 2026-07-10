import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'
import {
  greedyRouteOptimization,
  calculateRouteSegments,
  haversineDistance,
} from '@/lib/pricing'

export const dynamic = 'force-dynamic'

interface OrderItem {
  productId?: string
  name?: string
  description?: string
  weight?: number
  packaging?: string | null
  category?: string | null
  quantity: number
}

interface StopInput {
  customerName: string
  weight: number
  address: string
  lat: number
  lng: number
  operationNumber?: string | null
  items?: OrderItem[]
  price?: number | null // costo de domicilio ya calculado (viene del pedido)
}

function weightFromItems(items: OrderItem[] | undefined, fallback: number): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 1
  const w = items.reduce((a, it) => a + (Number(it.weight) || 0) * (Number(it.quantity) || 0), 0)
  return w > 0 ? w : (fallback || 1)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const route = await prisma.route.findFirst({
    where: { id, ...scopeWhere(scope) },
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

  const scope = await resolveScope(req, user)
  const route = await prisma.route.findFirst({
    where: { id, ...scopeWhere(scope) },
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

    const origin = { lat: route.originLat ?? 0, lng: route.originLng ?? 0 }

    // Capacity validation (existing + new)
    if (route.vehicleId && route.vehicle) {
      const existingWeight = route.orders.reduce((sum, o) => sum + o.weight, 0)
      const newWeight = newStops.reduce((sum, s) => sum + weightFromItems(s.items, s.weight), 0)
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
            weight: weightFromItems(s.items, s.weight),
            price: Number(s.price) || 0, // costo de domicilio del pedido (no se recalcula)
            items: (Array.isArray(s.items) ? s.items : []) as unknown as Prisma.InputJsonValue,
            tripLeg: 'outbound',
            routeId: id,
            userId: scope.ownerId,
            ...(scope.branchId ? { branchId: scope.branchId } : {}),
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

    // Distancia real del recorrido (informativa). El precio NO se recalcula: el total
    // de la ruta es la suma de los costos de domicilio de sus pedidos.
    const segs = calculateRouteSegments(origin, orderedStops)
    let totalDistance = segs.reduce((a, b) => a + b, 0)
    if (orderedStops.length > 0) {
      const last = orderedStops[orderedStops.length - 1]
      totalDistance += haversineDistance(last.lat, last.lng, origin.lat, origin.lng)
    }

    let totalWeight = 0
    let totalPrice = 0

    for (let i = 0; i < optimizedIds.length; i++) {
      const oid = optimizedIds[i]
      const order = ordersMap[oid]
      const distKm = haversineDistance(origin.lat, origin.lng, (order.endLat ?? order.lat)!, (order.endLng ?? order.lng)!)
      totalWeight += order.weight
      totalPrice += order.price || 0

      await prisma.order.update({
        where: { id: oid },
        data: { stopOrder: i + 1, tripLeg: 'outbound', segmentKm: distKm }
      })
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

  const scope = await resolveScope(req, user)
  const route = await prisma.route.findFirst({
    where: { id, ...scopeWhere(scope) }
  })
  if (!route) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  if (route.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: route.vehicleId } })
    if (vehicle?.status === 'in_use') {
      await prisma.vehicle.update({ where: { id: route.vehicleId }, data: { status: 'available' } })
    }
  }

  // Los pedidos IMPORTADOS (source='pedido') solo se desvinculan: vuelven al pool para
  // poder re-rutearlos. Los creados a mano en esta ruta (source distinto) sí se borran.
  await prisma.order.updateMany({
    where: { routeId: id, source: 'pedido' },
    data: { routeId: null, stopOrder: null, segmentKm: null, tripLeg: 'outbound' },
  })
  await prisma.order.deleteMany({ where: { routeId: id, NOT: { source: 'pedido' } } })
  await prisma.route.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
