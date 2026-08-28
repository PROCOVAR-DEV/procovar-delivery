import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * La lista de pedidos, ACOTADA.
 *
 * Esto hacía `findMany` sin tope, con la ruta y la sucursal incluidas, y devolvía `meta`
 * —el payload COMPLETO de PEDIDO: pedido, cliente, vendedor y gestor— por cada fila. Con
 * los quince días del espejo son miles de pedidos y decenas de megas a un navegador que
 * va a pintar veinticinco filas. La pantalla se quedaba cargando y parecía colgada.
 *
 * Ahora se piden los campos que la lista usa, `meta` se lee para sacar el municipio y el
 * vendedor y NO se manda, y hay un tope. Lo de siempre: el tope va en el servidor,
 * porque el que tumba el servicio no es el que se entera.
 */
const TOPE_LISTA = 1000

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const orders = await prisma.order.findMany({
    where: scopeWhere(scope),
    /**
     * La VENTANA la elige `createdAt`; el orden que se ve, la fecha del pedido (abajo).
     *
     * Ordenar aquí por `orderDate` parece lo correcto y no lo es todavía: en Postgres un
     * nulo en un DESC va PRIMERO, y ahora mismo los 12.000 pedidos que ya están en el
     * espejo lo tienen en null —la columna es nueva—. Con un tope, esos nulos se comerían
     * la ventana entera y los recién traídos, que son los que sí traen fecha, no
     * entrarían nunca.
     *
     * `createdAt` no tiene nulos y dice cuándo entró en el espejo, que para elegir "los
     * más recientes" vale. El orden final es un COALESCE y se hace abajo.
     */
    orderBy: { createdAt: 'desc' },
    take: TOPE_LISTA,
    select: {
      id: true,
      operationNumber: true,
      customerName: true,
      customerPhone: true,
      address: true,
      endAddress: true,
      endLat: true,
      endLng: true,
      weight: true,
      status: true,
      notes: true,
      routeId: true,
      deliveryPrice: true,
      deliveryDistanceKm: true,
      items: true,
      orderDate: true,
      createdAt: true,
      deliveredAt: true,
      stopOrder: true,
      // Se lee para sacar el municipio y el vendedor; NO se devuelve.
      meta: true,
      route: {
        select: {
          id: true,
          name: true,
          routeCode: true,
          status: true,
          deliveryDate: true,
          vehicle: { select: { name: true, plate: true } },
        },
      },
      // Almacén de origen (punto de partida) para dibujar el recorrido en el detalle.
      branch: { select: { id: true, name: true, lat: true, lng: true } },
    },
  })

  // La lista muestra `price`; el costo de domicilio se guarda en `deliveryPrice`.
  // Del `meta` sólo salen el municipio y el vendedor: el resto no lo usa nadie aquí y
  // mandarlo era lo que hacía la respuesta impagable.
  const filas = orders.map((o) => {
    const { meta, ...rest } = o
    const m = meta as {
      cliente?: { municipio?: string }
      vendedor?: { nombre?: string; codigo?: string }
    } | null

    return {
      ...rest,
      price: o.deliveryPrice ?? null,
      municipio: m?.cliente?.municipio || null,
      vendedor: m?.vendedor?.nombre || m?.vendedor?.codigo || null,
    }
  })

  /**
   * El orden final, con la fecha que de verdad se enseña.
   *
   * La lista pinta `orderDate` y, si no lo hay, `createdAt`. Ordenarlo en la base por
   * `orderDate` a secas deja dos cosas mal: en Postgres un nulo en un DESC va PRIMERO
   * —así que los pedidos viejos, los que entraron antes de que se guardara la fecha, se
   * plantaban en lo alto de la lista por delante de los de hoy— y los que sí la tienen no
   * se comparan nunca con los que no.
   *
   * `COALESCE(orderDate, createdAt)` es lo que hay que ordenar, y eso Prisma 5 no lo sabe
   * pedir. Son como mucho mil filas ya traídas: ordenarlas aquí cuesta nada.
   */
  filas.sort(
    (a, b) =>
      new Date(b.orderDate ?? b.createdAt).getTime() - new Date(a.orderDate ?? a.createdAt).getTime(),
  )

  return NextResponse.json(filas)
}

/**
 * El alta manual de pedidos SE VA.
 *
 * Los pedidos entran por una sola puerta: el espejo de PEDIDO. El formulario que llamaba
 * aquí ya se quitó —eso lo hace delivery-apk—, pero el endpoint se quedó, y un endpoint
 * que crea pedidos sin sucursal, sin fecha y sin `source` es una segunda puerta abierta:
 * el pedido que entra por ella no cuadra con PEDIDO y no hay forma de saber de dónde
 * salió.
 *
 * Se contesta 410 y no 404 a propósito: 404 dice "no existe" y quien lo vea buscará el
 * error en la URL. Esto sí existió, y lo que hay que saber es que se quitó.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'El alta manual de pedidos se retiró. Los pedidos entran desde PEDIDO (espejo) y el costo del domicilio lo pone delivery-apk.',
    },
    { status: 410 },
  )
}
