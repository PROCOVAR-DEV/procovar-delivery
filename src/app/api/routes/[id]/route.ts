import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'
import { avisarEstadoDeFondo, type EstadoEntrega } from '@/lib/avisarEstadoAPedido'
import {
  greedyRouteOptimization,
  calculateRouteSegments,
  haversineDistance,
} from '@/lib/pricing'

export const dynamic = 'force-dynamic'

/**
 * Las horas de salida y regreso que corresponden a un cambio de estado.
 *
 * Se usan en los dos caminos que actualizan la ruta (el que recalcula paradas y el
 * simple), y por eso vive aquí: tenerlo escrito dos veces es que un día uno de los dos
 * deje de marcarlas y nadie se entere hasta que haga falta el dato.
 */
function horasDelEstado(
  ruta: { startedAt: Date | null; finishedAt: Date | null },
  estado: string | undefined,
): { startedAt?: Date; finishedAt?: Date | null } {
  if (estado === 'in_progress') {
    return {
      ...(ruta.startedAt ? {} : { startedAt: new Date() }),
      ...(ruta.finishedAt ? { finishedAt: null } : {}),
    }
  }
  if (estado === 'completed') return { finishedAt: new Date() }
  return {}
}

interface OrderItem {
  productId?: string
  name?: string
  description?: string
  weight?: number
  /** Peso de la LÍNEA ya resuelto (packs x peso por unidad de venta). Ver homeDeliveryQuote. */
  weightKg?: number | null
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

/**
 * El peso de una parada.
 *
 * Las líneas que vienen de PEDIDO traen `weightKg`: el peso de la línea ENTERA, ya
 * resuelto contra Ventra. Esto sólo miraba `weight x quantity` —que en esas líneas no
 * existe—, así que daba cero y se caía al respaldo: la ruta se planificaba con el peso
 * que hubiera mandado la pantalla y no con el de los productos.
 */
function weightFromItems(items: OrderItem[] | undefined, fallback: number): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 1
  const w = items.reduce((a, it) => {
    const linea = Number(it.weightKg)
    if (Number.isFinite(linea) && linea > 0) return a + linea
    return a + (Number(it.weight) || 0) * (Number(it.quantity) || 0)
  }, 0)
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

  /**
   * Aquí se podían AÑADIR paradas tecleadas a una ruta ya creada, y con ellas se creaban
   * pedidos nuevos.
   *
   * Se quitó el 03/09/2026, igual que en la creación de la ruta y por lo mismo: un pedido
   * nacido aquí no tiene folio de PEDIDO, no se le puede atar una factura, no pasa por el
   * cotejo, y en un camión sólo sube lo facturado y que cuadra. Se creaba algo que después
   * no se podía repartir.
   *
   * Para meter un pedido más en una ruta se elige de los que ya existen.
   */

  const horas = horasDelEstado(route, data.status)

  /**
   * Poner una ruta EN CURSO ocupa su camión; completarla lo libera.
   *
   * Es el único momento en que el camión está de verdad fuera. Antes se ocupaba al crear
   * la ruta, y eso impedía planificar la siguiente con el mismo camión mientras estaba
   * repartiendo, que es cuando se planifica.
   */
  if (data.status === 'in_progress' && route.vehicleId) {
    await prisma.vehicle.update({ where: { id: route.vehicleId }, data: { status: 'in_use' } })
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
      ...horas,
    }
  })

  /**
   * Y se le cuenta a PEDIDO: el camión salió.
   *
   * Es lo que el vendedor necesita saber para poder decirle al cliente «va en camino» sin
   * llamar a nadie. Sólo al ARRANCAR: al completar la ruta cada pedido ya tiene su propio
   * resultado —entregado, devuelto o cancelado—, puesto una por una al cerrarla, y
   * pisarlos todos con un estado de la ruta borraría justo eso.
   */
  if (data.status === 'in_progress') {
    const pedidos = await prisma.order.findMany({
      where: { routeId: id, source: 'pedido', externalId: { not: null } },
      select: { externalId: true },
    })

    avisarEstadoDeFondo(
      pedidos.map((o) => ({ pedidoId: o.externalId as string, estado: 'en_transito' as EstadoEntrega })),
    )
  }

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

  /**
   * Borrar la ruta NO borra pedidos: todos vuelven a la lista para poder re-rutearlos.
   *
   * Los de PEDIDO se desvinculaban y los demás se BORRABAN, de cuando «los demás» eran
   * paradas tecleadas dentro de la propia ruta. Ahora un pedido a mano es un pedido como
   * cualquiera —con su cliente, su peso y su costo—, y deshacer una ruta no puede
   * llevárselo por delante: se armó mal la ruta, no se canceló el pedido.
   */
  await prisma.order.updateMany({
    where: { routeId: id },
    data: { routeId: null, stopOrder: null, segmentKm: null, tripLeg: 'outbound' },
  })
  await prisma.route.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
