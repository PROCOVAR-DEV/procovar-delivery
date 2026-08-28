import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'
import { leerFiltros, whereDeFiltros } from '@/lib/filtrosPedido'

export const dynamic = 'force-dynamic'

/**
 * El catálogo de pedidos: filtrado y paginado EN EL SERVIDOR.
 *
 * Aquí ha habido dos versiones malas. La primera hacía `findMany` sin tope y devolvía
 * `meta` —el pedido completo de PEDIDO: cliente, vendedor y gestor— por cada fila: con
 * miles de pedidos eran decenas de megas a un navegador que pinta veinticinco. La
 * segunda puso un tope de mil y dejó los filtros en la pantalla, que es lo mismo con
 * otra cara: filtrar sobre las mil primeras filas no es filtrar el catálogo, es filtrar
 * un trozo y no decirlo.
 *
 * Ahora filtra la base. Son 50.000 pedidos —el histórico entero, archivados incluidos,
 * porque una ruta se arma también con pedidos ya completados— y la única forma de
 * trabajar con eso es que el servidor devuelva la página que se está mirando.
 */

/** Tamaño de página. El tope es del servidor: quien tumba el servicio no se entera. */
const POR_PAGINA = 50
const MAX_POR_PAGINA = 200

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const filtros = leerFiltros(params)

  const pagina = Math.max(1, Number(params.get('pagina')) || 1)
  const porPagina = Math.min(MAX_POR_PAGINA, Math.max(1, Number(params.get('porPagina')) || POR_PAGINA))

  const scope = await resolveScope(req, user)
  const where = { AND: [scopeWhere(scope), whereDeFiltros(filtros)] }

  /**
   * El ORDEN: por la fecha del pedido, y los que no la tienen al final.
   *
   * En Postgres un nulo en un DESC va PRIMERO, así que sin decirle nada los pedidos sin
   * fecha —los que entraron antes de que se guardara— se plantarían en lo alto de todas
   * las páginas. El respaldo por `createdAt` los coloca entre ellos por cuándo entraron,
   * que es lo único que se sabe de ellos.
   */
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
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
        estado: true,
        archivado: true,
        fechaComprometida: true,
        requiereDomicilio: true,
        pedidoCosto: true,
        municipio: true,
        vendedor: true,
        sucursalCodigo: true,
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
    }),
  ])

  // La lista muestra `price`; el costo que calcula delivery está en `deliveryPrice`.
  // `pedidoCosto` es OTRA cosa —lo que la APK cobró en PEDIDO— y va aparte a propósito:
  // son dos números distintos y confundirlos es cobrar uno por el otro.
  const filas = orders.map((o) => ({ ...o, price: o.deliveryPrice ?? null }))

  return NextResponse.json({
    orders: filas,
    total,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  })
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
