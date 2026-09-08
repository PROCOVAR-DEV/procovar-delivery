import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

/**
 * Lo que de verdad se puede meter en un camión hoy.
 *
 * Tres condiciones, y las tres hacen falta:
 *
 *   `routeId: null`        no está ya en una ruta.
 *   `endLat` no nulo       se sabe a dónde llevarlo.
 *   factura `igual`|`cambiado`   tiene factura. Lo que sube al camión es lo facturado, y
 *                          si cambió se carga con las líneas de la factura. Sin factura no
 *                          hay nada que llevar, y sin cotejar no se sabe qué se llevaría.
 *
 * Es el mismo listón que el armador de rutas. Si los dos no dicen lo mismo, el panel
 * promete pedidos que luego no aparecen al armar la ruta.
 */
const REPARTIBLE: Prisma.OrderWhereInput = {
  routeId: null,
  endLat: { not: null },
  facturaEstado: { in: ['igual', 'cambiado'] },
}

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

  /**
   * Lo que hace falta para CONTROLAR ENVÍOS, no para cuadrar caja.
   *
   * Antes esto enseñaba el total de órdenes, los "ingresos totales" —la suma del precio
   * de la mercancía— y el precio medio por orden. Ninguno de los tres es de delivery: el
   * precio del pedido es de PEDIDO, y tenerlo en dos pantallas invita a cuadrarlas entre
   * sí, que es como se descubre tarde que no coinciden.
   *
   * Lo que sí es suyo: cuántos pedidos esperan ruta, cuántas rutas hay en marcha, cuánto
   * peso queda por mover y cuánto se ha cobrado de domicilio. Y sobre todo: los
   * PENDIENTES, que es el único número que pide hacer algo.
   */
  const hoy = new Date()

  hoy.setHours(0, 0, 0, 0)

  const [
    totalOrders,
    sinRuta,
    rutasActivas,
    entregadosHoy,
    totalVehicles,
    vehiculosEnRuta,
    pendientes,
    domicilios,
    porSucursal,
  ] = await Promise.all([
    prisma.order.count({ where }),
    // El número que pide acción: pedidos que SE PUEDEN MOVER y no están en ninguna ruta.
    //
    // Antes contaba todo lo que tuviera destino, y decía 17.415 con cuatro millones de
    // kilos «por mover». No eran movibles: el espejo guarda también el histórico de
    // PEDIDO, y de todo eso sólo se puede cargar lo que tiene factura. Un número que pide
    // acción tiene que ser sobre lo accionable, o no lo mira nadie.
    prisma.order.count({ where: { ...where, ...REPARTIBLE } }),
    prisma.route.count({ where: { ...where, status: { notIn: ['completed', 'cancelled'] } } }),
    prisma.order.count({ where: { ...where, deliveredAt: { gte: hoy } } }),
    prisma.vehicle.count({ where }),
    prisma.vehicle.count({ where: { ...where, orders: { some: { route: { status: { notIn: ['completed', 'cancelled'] } } } } } }),
    // El peso que queda por mover. Es lo que dice si hace falta otro camión.
    prisma.order.aggregate({
      where: { ...where, ...REPARTIBLE },
      _sum: { weight: true },
    }),
    // El costo del domicilio SÍ es de delivery. El precio de la mercancía no.
    prisma.order.aggregate({ where, _sum: { pedidoCosto: true } }),
    // Dónde está lo pendiente: sin esto, "412 sin ruta" no dice por dónde empezar.
    prisma.order.groupBy({
      by: ['branchId'],
      where: { ...where, ...REPARTIBLE },
      _count: { _all: true },
      _sum: { weight: true },
    }),
  ])

  const sucursales = await prisma.branch.findMany({ select: { id: true, name: true } })
  const nombre = new Map(sucursales.map((b) => [b.id, b.name]))

  return NextResponse.json({
    totalOrders,
    sinRuta,
    rutasActivas,
    entregadosHoy,
    totalVehicles,
    vehiculosEnRuta,
    pesoPendiente: pendientes._sum.weight ?? 0,
    // Lo COBRADO, que es lo de PEDIDO. La estimación propia de delivery no la paga nadie.
    totalDomicilios: domicilios._sum.pedidoCosto ?? 0,
    porSucursal: porSucursal
      .map((g) => ({
        sucursal: g.branchId ? nombre.get(g.branchId) ?? 'Sin sucursal' : 'Sin sucursal',
        pedidos: g._count._all,
        pesoKg: g._sum.weight ?? 0,
      }))
      .sort((a, b) => b.pedidos - a.pedidos),
  })
}
