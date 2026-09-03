import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere, sucursalDeLaPersona } from '@/lib/scope'
import { costoDomicilioEntrega, distanciaHaversineKm } from '@/lib/domicilioEntrega'
import { tasaDeSucursal } from '@/lib/tasaCambio'
import { almacenesDeSucursal } from '@/lib/almacenes'
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
        // Cómo acabó la parada. Manda sobre el estado de la ruta: una ruta completada no
        // dice nada de cada parada, y sin esto un devuelto se pintaba «entregado».
        resultado: true,
        resultadoNota: true,
        stopOrder: true,
        estado: true,
        archivado: true,
        fechaComprometida: true,
        requiereDomicilio: true,
        pedidoCosto: true,
        facturaEstado: true,
        facturaNumero: true,
        // Lo que la factura cobró por el reparto. Copiado de PEDIDO: es la señal de que
        // ese pedido va a domicilio, y sale de lo que se cobró, no de una casilla.
        facturaDomicilio: true,
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

  /**
   * El TOTAL POR PRODUCTO de lo filtrado. Es el pre-despacho.
   *
   * Filtrar por un día y una sucursal contesta «cuántos pedidos», pero al almacén hay que
   * decirle CUÁNTO SACAR de cada cosa: 340 cajas de malta, 120 de cerveza. Eso se sacaba
   * a mano abriendo pedido por pedido.
   *
   * Se cuenta sobre TODO lo filtrado, no sobre la página: media lista da media carga, y
   * el camión sale corto sin que nadie lo note. Con tope, porque el catálogo entero son
   * cincuenta mil pedidos y esto no puede tumbar la pantalla.
   */
  /**
   * Y sólo si se pide.
   *
   * Sumar el pre-despacho es leerse TODOS los pedidos filtrados con sus líneas. Hacerlo
   * en cada carga de la lista la volvía lenta —y la lista se carga en cada tecla del
   * buscador—. Se pide aparte, cuando alguien abre el pre-despacho.
   */
  const TOPE_RESUMEN = 5000
  const quiereResumen = params.get('resumen') === '1'
  const paraResumen = quiereResumen && total <= TOPE_RESUMEN
    ? await prisma.order.findMany({ where, select: { items: true, weight: true } })
    : []

  const porProducto = new Map<string, { producto: string; formatos: number; unidades: number; pesoKg: number }>()

  for (const o of paraResumen) {
    const items = (Array.isArray(o.items) ? o.items : []) as Array<{
      name?: string
      description?: string
      packs?: number
      quantity?: number
      weightKg?: number
    }>

    for (const it of items) {
      const nombre = (it?.name || it?.description || '').trim()

      if (!nombre) continue
      const acumulado = porProducto.get(nombre) ?? { producto: nombre, formatos: 0, unidades: 0, pesoKg: 0 }

      acumulado.formatos += Number(it.packs) || 0
      acumulado.unidades += Number(it.quantity) || 0
      acumulado.pesoKg += Number(it.weightKg) || 0
      porProducto.set(nombre, acumulado)
    }
  }

  const resumen = [...porProducto.values()]
    .map((p) => ({ ...p, pesoKg: Number(p.pesoKg.toFixed(2)) }))
    .sort((a, b) => b.formatos - a.formatos)

  return NextResponse.json({
    orders: filas,
    total,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
    // `null` cuando no se pidió o hay demasiados: las dos cosas son distintas de «no hay».
    resumen: quiereResumen ? (total <= TOPE_RESUMEN ? resumen : null) : undefined,
    resumenTope: TOPE_RESUMEN,
    pesoTotal: Number(paraResumen.reduce((t, o) => t + (o.weight || 0), 0).toFixed(2)),
  })
}

/**
 * El alta manual de pedidos SE VA.
 *
 * Los pedidos entran por una sola puerta: el espejo de PEDIDO. El formulario que llamaba
 * aquí ya se quitó —eso lo hace Entrega—, pero el endpoint se quedó, y un endpoint
 * que crea pedidos sin sucursal, sin fecha y sin `source` es una segunda puerta abierta:
 * el pedido que entra por ella no cuadra con PEDIDO y no hay forma de saber de dónde
 * salió.
 *
 * Se contesta 410 y no 404 a propósito: 404 dice "no existe" y quien lo vea buscará el
 * error en la URL. Esto sí existió, y lo que hay que saber es que se quitó.
 */
/**
 * Aquí estaba `POST /api/orders`: el alta de un pedido A MANO.
 *
 * Se quitó el 03/09/2026. **Un pedido nace en PEDIDO y en ningún otro sitio.**
 *
 * Un pedido metido aquí no tiene folio de PEDIDO, así que no se le puede atar una factura
 * de Ventra; no pasa por el cotejo, así que nunca cuadra; y como en una ruta sólo entra lo
 * facturado y que cuadra, no se podía repartir. Era una puerta que dejaba crear algo que
 * después no servía para nada, y que además duplicaba clientes y pedidos que ya existen
 * del otro lado.
 *
 * Si hace falta repartir algo que no pasó por PEDIDO, se mete en PEDIDO.
 */
