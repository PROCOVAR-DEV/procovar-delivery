import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

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

  // Scopeado por sucursal (dueño + sucursal), igual que el resto de la app. Antes filtraba
  // por userId del usuario logueado, y un admin de sucursal veía VACÍO (el dato es del owner).
  const scope = await resolveScope(req, user)

  const dbOrders = await prisma.order.findMany({
    where: {
      ...scopeWhere(scope),
      ...dateFilter,
      ...vehicleFilter,
    },
    include: {
      route: { select: { id: true, name: true, routeCode: true, vehicle: { select: { id: true, name: true, plate: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Ingreso por pedido = su costo de domicilio. `price` se llena al rutear; para los
  // pedidos aún no ruteados usamos `deliveryPrice` (el costo ya calculado del domicilio).
  const revenueOf = (o: { price: number | null; deliveryPrice: number | null }) =>
    (o.price != null ? o.price : (o.deliveryPrice ?? 0))

  // Flatten the vehicle from the route for easy display/export.
  const orders = dbOrders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    address: o.address,
    endAddress: o.endAddress,
    weight: o.weight,
    price: revenueOf(o),
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
    byVehicle[v.id].revenue += revenueOf(o)
    byVehicle[v.id].weight += o.weight || 0
  }

  return NextResponse.json({
    orders,
    summary: { totalOrders: orders.length, totalRevenue, totalWeight, avgPrice },
    byVehicle: Object.values(byVehicle),
  })
}
