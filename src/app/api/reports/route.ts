import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const vehicleId = searchParams.get('vehicleId')

  const dateFilter = from || to
    ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to + 'T23:59:59.999Z') } : {}),
        },
      }
    : {}

  // Orders are tied to a vehicle through their route.
  const vehicleFilter = vehicleId ? { route: { vehicleId } } : {}

  const dbOrders = await prisma.order.findMany({
    where: {
      userId: user.id as string,
      ...dateFilter,
      ...vehicleFilter,
    },
    include: {
      route: { select: { id: true, name: true, routeCode: true, vehicle: { select: { id: true, name: true, plate: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Flatten the vehicle from the route for easy display/export.
  const orders = dbOrders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    address: o.address,
    endAddress: o.endAddress,
    weight: o.weight,
    price: o.price,
    segmentKm: o.segmentKm,
    createdAt: o.createdAt,
    routeName: o.route?.routeCode || o.route?.name || null,
    vehicleName: o.route?.vehicle?.name || null,
    vehiclePlate: o.route?.vehicle?.plate || null,
  }))

  const totalRevenue = orders.reduce((s, o) => s + (o.price || 0), 0)
  const totalWeight = orders.reduce((s, o) => s + (o.weight || 0), 0)
  const avgPrice = orders.length > 0 ? totalRevenue / orders.length : 0

  // Per-vehicle breakdown via the route's vehicle.
  const byVehicle: Record<string, { name: string; plate: string | null; count: number; revenue: number; weight: number }> = {}
  for (const o of dbOrders) {
    const v = o.route?.vehicle
    if (!v) continue
    if (!byVehicle[v.id]) {
      byVehicle[v.id] = { name: v.name, plate: v.plate, count: 0, revenue: 0, weight: 0 }
    }
    byVehicle[v.id].count++
    byVehicle[v.id].revenue += o.price || 0
    byVehicle[v.id].weight += o.weight || 0
  }

  return NextResponse.json({
    orders,
    summary: { totalOrders: orders.length, totalRevenue, totalWeight, avgPrice },
    byVehicle: Object.values(byVehicle),
  })
}
