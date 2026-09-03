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

import { avisarCambio } from '@/lib/avisarCambio'
import { avisarEstadoDeFondo } from '@/lib/avisarEstadoAPedido'

export const dynamic = 'force-dynamic'

/**
 * Aquí vivían `OrderItem`, `StopInput` y `weightFromItems`: las paradas que se TECLEABAN
 * dentro de una ruta. Se fueron el 03/09/2026 — una ruta se arma con pedidos que ya
 * existen, y el peso lo trae cada pedido ya resuelto desde el espejo.
 */

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

  /**
   * Los pedidos se buscan por SUCURSAL, nunca por quién los creó.
   *
   * Aquí estaba `userId` y era la razón de "los pedidos seleccionados ya no están
   * disponibles": estos pedidos los trae la sincronización desde PEDIDO, así que su
   * `userId` es el de quien la lanzó, no el de quien está creando la ruta. La consulta
   * no cuadraba con ninguno y el formulario lo contaba como si los pedidos hubieran
   * desaparecido — cuando estaban ahí, en la lista, recién elegidos.
   *
   * Es el mismo fallo que ya se había corregido para LEER (ver el comentario de
   * `scopeWhere` en lib/scope.ts) y que aquí, al escribir, se quedó puesto.
   */
  const orders = await prisma.order.findMany({
    where: {
      // Los de PEDIDO y los metidos a mano: los dos se reparten igual. Pedía sólo
      // `'pedido'`, así que un pedido manual se podía elegir en la lista y al generar la
      // ruta contestaba «ya no están disponibles» — sin decir que el motivo era su origen.
      // Sólo los de PEDIDO: el alta a mano se quitó y no quedan pedidos que no vengan
      // de allí. Ver el comentario donde estaba `POST /api/orders`.
      id: { in: orderIds }, source: 'pedido', routeId: null,
      endLat: { not: null }, endLng: { not: null },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
  })

  if (orders.length === 0) {
    return NextResponse.json({ error: 'Los pedidos seleccionados ya no están disponibles' }, { status: 400 })
  }

  // Si alguno se coló en otra ruta mientras se elegía, se dice CUÁL y no se calla: con
  // el mensaje genérico, alguien crea la ruta creyendo que lleva diez paradas y lleva
  // nueve.
  if (orders.length < orderIds.length) {
    const faltan = orderIds.filter((id) => !orders.some((o) => o.id === id)).length

    return NextResponse.json(
      { error: `${faltan} de los ${orderIds.length} pedidos ya están en otra ruta. Vuelve a elegirlos.` },
      { status: 409 },
    )
  }

  /**
   * Y NADA que no esté facturado y cuadre sube al camión.
   *
   * Se comprueba aquí, aunque la pantalla ya sólo ofrezca los que cuadran, porque una
   * pantalla no es una garantía: basta con que alguien mande los ids a mano, o con que un
   * pedido se coteje otra vez entre que se eligió y se generó la ruta. Lo que se carga
   * tiene que ser lo que se cobró.
   *
   * Se dice CUÁLES y en qué estado están. Un «no se pudo» a secas obliga a adivinar cuál
   * de los quince pedidos es el que sobra.
   */
  const noFacturados = orders.filter((o) => o.facturaEstado !== 'igual')

  if (noFacturados.length > 0) {
    const motivo = (e: string | null) =>
      e === 'cambiado' ? 'cambió en la factura' : e === 'sin_factura' ? 'sin facturar' : 'sin cotejar'
    const detalle = noFacturados
      .slice(0, 5)
      .map((o) => `${o.operationNumber || o.customerName} (${motivo(o.facturaEstado)})`)
      .join(', ')

    return NextResponse.json(
      {
        error:
          `En una ruta sólo entra lo facturado y que cuadre. ${noFacturados.length} no cumplen: ` +
          detalle +
          (noFacturados.length > 5 ? ` y ${noFacturados.length - 5} más.` : '.'),
      },
      { status: 409 },
    )
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
    // El costo del domicilio es el de PEDIDO: lo pone el repartidor desde Entrega.
    totalPrice += o.pedidoCosto || 0
    await prisma.order.update({
      where: { id: o.id },
      // `ultimaRutaId` va junto a `routeId` y no se suelta nunca: es en qué camión viajó.
      data: { routeId: route.id, ultimaRutaId: route.id, stopOrder: i + 1, tripLeg: 'outbound', segmentKm: distKm, price: o.pedidoCosto || 0 },
    })
  }

  await prisma.route.update({
    where: { id: route.id },
    data: { totalDistance, totalWeight, totalPrice, optimized: true },
  })
  /**
   * Crear una ruta NO ocupa el camión: se planifica, no se despacha.
   *
   * Lo marcaba «en uso» al crearla, así que el camión que está repartiendo ahora no se
   * podía usar para armar la ruta de mañana — y armarla es justo lo que se hace mientras
   * el camión está fuera. El camión se ocupa cuando la ruta se pone EN CURSO, y se
   * libera al completarla.
   */

  const full = await prisma.route.findUnique({
    where: { id: route.id },
    include: {
      vehicle: { select: { id: true, name: true, type: true, plate: true, capacity: true } },
      orders: { orderBy: { stopOrder: 'asc' } },
    },
  })
  // Una ruta nueva se lleva pedidos de la lista de disponibles: hay que enterarse.
  await avisarCambio('rutas')

  /**
   * Y en PEDIDO, esos pedidos pasan a DESPACHADOS.
   *
   * Es la primera noticia que tiene el vendedor de que su pedido se movió. Va de fondo: si
   * PEDIDO no contesta, la ruta se crea igual — lo que no puede pasar es que no se pueda
   * armar una ruta porque otra aplicación esté caída.
   */
  avisarEstadoDeFondo(
    (full?.orders ?? [])
      .filter((o) => o.source === 'pedido' && o.externalId)
      .map((o) => ({ pedidoId: o.externalId as string, estado: 'despachado' as const })),
  )

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
      /**
       * De qué sucursal es la ruta.
       *
       * No venía, así que el Super Admin —que las ve todas— tenía las de las ocho
       * sucursales en una sola lista sin nada que las distinguiera: dos rutas del mismo
       * día con el mismo aspecto podían ser de Holguín y de La Habana. La pantalla las
       * agrupa por aquí.
       */
      branch: { select: { id: true, name: true, externalId: true } },
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
          // Cómo acabó la parada al volver el camión. De esto sale el post-despacho: lo
          // que queda arriba es lo que no se entregó.
          resultado: true,
          resultadoNota: true,
          municipio: true,
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
    orderIds = [],
    branchId,
  }: {
    name?: string
    vehicleId?: string
    originAddress?: string
    originLat?: number
    originLng?: number
    deliveryDate?: string
    orderIds?: string[]
    branchId?: string
  } = await req.json()

  if (originLat == null || originLng == null) {
    return NextResponse.json({ error: 'Las coordenadas del punto de partida son requeridas' }, { status: 400 })
  }

  if (!vehicleId) {
    return NextResponse.json({ error: 'Se requiere un vehículo para crear la ruta' }, { status: 400 })
  }

  const scope = await resolveScope(req, user)

  /**
   * La sucursal que eligió quien crea la ruta, no la del alcance.
   *
   * Un Super Admin trabaja con alcance "todas", así que `scope.branchId` es null y la
   * ruta se creaba sin sucursal — o con la del primer pedido, por casualidad. Ahora la
   * dice él en el primer paso del asistente.
   *
   * Quien SÍ tiene alcance no puede saltárselo pasando otra por el cuerpo: manda el
   * suyo. Es la misma regla que en el resto de la aplicación.
   */
  const sucursalRuta = scope.branchId ?? (branchId?.trim() || null)

  // CAMINO PREFERIDO: armar la ruta con PEDIDOS YA IMPORTADOS (se seleccionan de la
  // lista; ya tienen ubicación, peso y costo de domicilio). No se re-teclea nada.
  if (Array.isArray(orderIds) && orderIds.length > 0) {
    return await createRouteFromExistingOrders(scope.actorId, {
      name, vehicleId, originAddress, originLat, originLng, deliveryDate, orderIds, branchId: sucursalRuta,
    })
  }

  /**
   * Y no hay otro camino.
   *
   * Aquí se podían TECLEAR las paradas —cliente, dirección, coordenadas, productos— y la
   * ruta creaba pedidos nuevos con ellas. Eso creaba pedidos sin folio de PEDIDO: sin
   * factura que atarles, sin cotejo, y por tanto imposibles de repartir bajo la regla de
   * que en un camión sólo sube lo facturado. Una puerta para crear algo que no servía.
   *
   * Se quitó el 03/09/2026, con el alta de pedidos y clientes a mano. Una ruta se arma
   * eligiendo pedidos que ya existen.
   */
  return NextResponse.json(
    { error: 'Una ruta se arma eligiendo pedidos ya existentes. Manda `orderIds`.' },
    { status: 400 },
  )
}

