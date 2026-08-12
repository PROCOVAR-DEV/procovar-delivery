import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * Los números de arriba del panel.
 *
 * Contaban **los pedidos de la cuenta que mira** (`userId: user.id`), no los de
 * su sucursal. Eso daba cero a cualquiera que entrase con una cuenta nueva —
 * aunque su sucursal tuviera miles— y era el mismo error que el resto de la
 * aplicación ya tenía arreglado: aquí nada es de nadie, todo es de la sucursal.
 *
 * Los pedidos llegan solos desde PEDIDO y pertenecen a la sucursal que los
 * originó. Quien lleva una sucursal ve los suyos; quien no lleva ninguna —el
 * Super Admin— los ve todos.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const where = scopeWhere(scope)

  const [totalOrders, totalVehicles, orders] = await Promise.all([
    prisma.order.count({ where }),
    // Los vehículos SÍ tienen sucursal (`Vehicle.branchId`): se cuentan los de
    // la de quien mira. Antes esto contaba la flota entera por un despiste mío.
    prisma.vehicle.count({ where }),
    prisma.order.findMany({
      where,
      select: { price: true, weight: true },
    }),
  ])

  const totalRevenue = orders.reduce((sum, o) => sum + (o.price || 0), 0)
  const totalWeight = orders.reduce((sum, o) => sum + (o.weight || 0), 0)
  const avgPrice = totalOrders > 0 ? totalRevenue / totalOrders : 0

  return NextResponse.json({
    totalOrders,
    totalVehicles,
    totalRevenue,
    totalWeight,
    avgPrice,
  })
}
