import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import {
  greedyRouteOptimization,
  calculateRouteSegments,
  haversineDistance,
} from '@/lib/pricing'
import { resolveScope, scopeWhere } from '@/lib/scope'

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

function weightFromItems(items: OrderItem[] | undefined, fallback: number): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 1
  const w = items.reduce((a, it) => a + (Number(it.weight) || 0) * (Number(it.quantity) || 0), 0)
  return w > 0 ? w : (fallback || 1)
}

interface StopInput {
  customerName: string
  weight: number
  address: string
  lat: number
  lng: number
  operationNumber?: string | null
  items?: OrderItem[]
  // Costo de domicilio del pedido (ya calculado por PEDIDO). El generador de rutas NO
  // lo calcula: solo lo lleva para sumarlo en el total de la ruta.
  price?: number | null
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

/**
 * Arma una ruta a partir de PEDIDOS YA EXISTENTES (importados de PEDIDO): los asigna a la
 * ruta (routeId), optimiza el orden de visita, valida capacidad por peso y suma los costos
 * de domicilio (que ya venían calculados). No crea ni re-teclea pedidos.
 */
async function createRouteFromExistingOrders(
  userId: string,
  opts: {
    name?: string; vehicleId?: string; originAddress?: string
    originLat: number; originLng: number; deliveryDate?: string; orderIds: string[]
    branchId?: string | null
  },
) {
  const { name, vehicleId, originAddress, originLat, originLng, deliveryDate, orderIds } = opts

  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds }, userId, source: 'pedido', routeId: null,
      endLat: { not: null }, endLng: { not: null },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
  })
  if (orders.length === 0) {
    return NextResponse.json({ error: 'Los pedidos seleccionados ya no están disponibles' }, { status: 400 })
  }
  // La ruta pertenece a la sucursal de sus pedidos (o la elegida por el admin).
  const routeBranchId = opts.branchId ?? orders[0].branchId ?? null

  const totalW = orders.reduce((s, o) => s + (o.weight || 0), 0)
  const vehicle = vehicleId ? await prisma.vehicle.findFirst({ where: { id: vehicleId } }) : null
  if (vehicle && totalW > vehicle.capacity) {
    return NextResponse.json({
      error: `Peso total (${totalW.toFixed(1)} kg) supera la capacidad del vehículo (${vehicle.capacity} kg)`,
    }, { status: 400 })
  }

  const origin = { lat: originLat, lng: originLng }
  const routeCode = await generateRouteCode()
  const route = await prisma.route.create({
    data: {
      name: name || null, routeCode, userId,
      ...(vehicleId && { vehicleId }),
      ...(routeBranchId ? { branchId: routeBranchId } : {}),
      originAddress: originAddress ?? null, originLat, originLng,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
    },
  })

  const stopsForOpt = orders.map((o) => ({ id: o.id, lat: o.endLat!, lng: o.endLng! }))
  const optimizedIds =
    stopsForOpt.length > 1 ? greedyRouteOptimization(origin, stopsForOpt) : stopsForOpt.map((s) => s.id)
  const byId = Object.fromEntries(orders.map((o) => [o.id, o]))
  const orderedStops = optimizedIds.map((id) => ({ id, lat: byId[id].endLat!, lng: byId[id].endLng! }))

  // Distancia real del recorrido (informativa).
  const segs = calculateRouteSegments(origin, orderedStops)
  let totalDistance = segs.reduce((a, b) => a + b, 0)
  if (orderedStops.length > 0) {
    const last = orderedStops[orderedStops.length - 1]
    totalDistance += haversineDistance(last.lat, last.lng, origin.lat, origin.lng)
  }

  let totalWeight = 0
  let totalPrice = 0
  for (let i = 0; i < optimizedIds.length; i++) {
    const o = byId[optimizedIds[i]]
    const distKm = haversineDistance(origin.lat, origin.lng, o.endLat!, o.endLng!)
    totalWeight += o.weight || 0
    totalPrice += o.deliveryPrice || 0 // el costo de domicilio ya calculado
    await prisma.order.update({
      where: { id: o.id },
      data: { routeId: route.id, stopOrder: i + 1, tripLeg: 'outbound', segmentKm: distKm, price: o.deliveryPrice || 0 },
    })
  }

  await prisma.route.update({
    where: { id: route.id },
    data: { totalDistance, totalWeight, totalPrice, optimized: true },
  })
  if (vehicleId) await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: 'in_use' } })

  const full = await prisma.route.findUnique({
    where: { id: route.id },
    include: {
      vehicle: { select: { id: true, name: true, type: true, plate: true, capacity: true } },
      orders: { orderBy: { stopOrder: 'asc' } },
    },
  })
  return NextResponse.json(full, { status: 201 })
}

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const routes = await prisma.route.findMany({
    where: scopeWhere(scope),
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
          items: true,
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
    deliveryDate,
    stops = [],
    orderIds = [],
  }: {
    name?: string
    vehicleId?: string
    originAddress?: string
    originLat?: number
    originLng?: number
    deliveryDate?: string
    stops?: StopInput[]
    orderIds?: string[]
  } = await req.json()

  if (originLat == null || originLng == null) {
    return NextResponse.json({ error: 'Las coordenadas del punto de partida son requeridas' }, { status: 400 })
  }

  if (!vehicleId) {
    return NextResponse.json({ error: 'Se requiere un vehículo para crear la ruta' }, { status: 400 })
  }

  const scope = await resolveScope(req, user)

  // CAMINO PREFERIDO: armar la ruta con PEDIDOS YA IMPORTADOS (se seleccionan de la
  // lista; ya tienen ubicación, peso y costo de domicilio). No se re-teclea nada.
  if (Array.isArray(orderIds) && orderIds.length > 0) {
    return await createRouteFromExistingOrders(scope.ownerId, {
      name, vehicleId, originAddress, originLat, originLng, deliveryDate, orderIds, branchId: scope.branchId,
    })
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

  // El generador de rutas NO calcula precio: solo agrupa pedidos y valida capacidad
  // por peso. El costo de cada pedido ya viene calculado (domicilio) y el total de la
  // ruta es la suma de esos costos.

  // Validate vehicle capacity against total stop weight
  const totalStopWeight = stops.reduce((sum, s) => sum + weightFromItems(s.items, s.weight), 0)
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
      userId: scope.ownerId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(vehicleId && { vehicleId }),
      originAddress: originAddress ?? null,
      originLat,
      originLng,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
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
          weight: weightFromItems(s.items, s.weight),
          // Costo de domicilio ya calculado (viene del pedido). No se recalcula aquí.
          price: Number(s.price) || 0,
          items: (Array.isArray(s.items) ? s.items : []) as unknown as Prisma.InputJsonValue,
          tripLeg: 'outbound',
          routeId: route.id,
          userId: scope.ownerId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
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

  // Distancia REAL del recorrido del camión (depósito→s1→…→sN→depósito), solo informativa.
  const segs = calculateRouteSegments(origin, orderedStops)
  let totalDistance = segs.reduce((a, b) => a + b, 0)
  if (orderedStops.length > 0) {
    const last = orderedStops[orderedStops.length - 1]
    totalDistance += haversineDistance(last.lat, last.lng, origin.lat, origin.lng)
  }

  // Total de la ruta = SUMA de los costos de domicilio de sus pedidos (ya calculados).
  // El peso total valida la capacidad del camión. No se calcula ningún precio aquí.
  let totalWeight = 0
  let totalPrice = 0

  for (let i = 0; i < optimizedIds.length; i++) {
    const orderId = optimizedIds[i]
    const order = ordersMap[orderId]
    const distKm = haversineDistance(origin.lat, origin.lng, order.endLat!, order.endLng!)
    totalWeight += order.weight
    totalPrice += order.price || 0

    // Solo el orden de visita y la distancia (informativa); el precio no se toca.
    await prisma.order.update({
      where: { id: orderId },
      data: { stopOrder: i + 1, segmentKm: distKm },
    })
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
