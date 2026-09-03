import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'
import { leerFiltros, whereDeFiltros } from '@/lib/filtrosPedido'

export const dynamic = 'force-dynamic'

/** Cuántos pedidos como mucho. Ver el porqué junto al `take`. */
const TOPE = 2000

/**
 * GET /api/orders/available — Pedidos YA importados de PEDIDO que están listos para
 * meter en una ruta: son de origen `pedido`, tienen geolocalización y todavía NO están
 * en ninguna ruta. El armador de rutas los lista para SELECCIONARLOS (no re-teclearlos):
 * ya traen su ubicación, su peso y su costo de domicilio calculado.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams

  /**
   * Los MISMOS filtros que la lista de pedidos.
   *
   * Salen de `lib/filtrosPedido` para que signifiquen lo mismo en las dos pantallas: si
   * «expirado» quiere decir una cosa aquí y otra en la lista, los números no cuadran y
   * nadie sabe cuál creerse. Se aplican en la base: con 50.000 pedidos, filtrar en el
   * navegador es mandárselos todos primero.
   */
  const filtros = leerFiltros(params)

  /**
   * Y el DÍA, que aquí es lo primero que se elige.
   *
   * Una ruta se hace con los pedidos de UNA sucursal y de UN día. `fecha` es el atajo
   * para eso; el rango `desde`/`hasta` de los filtros generales sigue valiendo.
   */
  const fecha = params.get('fecha')?.trim() || ''
  const branchId = params.get('branchId')?.trim() || ''

  const scope = await resolveScope(req, user)
  const alcance = scopeWhere(scope)

  let porDia: { gte: Date; lt: Date } | undefined

  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const desde = new Date(`${fecha}T00:00:00`)
    const hasta = new Date(desde)

    hasta.setDate(hasta.getDate() + 1)
    // Un día entero, de medianoche a medianoche. Comparar sólo la fecha dejaría fuera
    // todo lo que no cayera exactamente a las 00:00.
    porDia = { gte: desde, lt: hasta }
  }

  const where = {
    AND: [
      alcance,
      whereDeFiltros(filtros),
      {
        // Si ya hay alcance, la sucursal pedida sólo puede estrecharlo, no ampliarlo.
        ...(branchId && (!alcance.branchId || alcance.branchId === branchId) ? { branchId } : {}),
        /**
         * Los de PEDIDO y los de aquí.
         *
         * Pedía sólo `source: 'pedido'`, así que un pedido metido a mano no aparecía
         * nunca en el armador: se podía crear y no se podía repartir, que es todo lo que
         * había que poder hacer con él.
         */
        // Sólo los de PEDIDO. El alta a mano en delivery se quitó el 03/09/2026.
        source: 'pedido',
        routeId: null,
        endLat: { not: null },
        endLng: { not: null },
        /**
         * SÓLO lo facturado y que cuadra. Aquí no se negocia.
         *
         * Era un filtro que la pantalla mandaba y se podía quitar, y así entró en una ruta
         * un pedido sin facturar el 2 de septiembre. Lo que sube al camión tiene que ser
         * lo que se cobró: si no, no cuadra la caja y nadie sabe después qué salió.
         *
         *   `cambiado`    — se facturó otra cosa. Se corrige en PEDIDO y entonces cuadra.
         *   `sin_factura` — todavía no se facturó. No hay nada que repartir.
         *   `null`        — no se ha cotejado: NO SE SABE, y lo que no se sabe no sube.
         */
        facturaEstado: 'igual',
      },
      /**
       * Por la fecha DEL PEDIDO, no por la de copiado.
       *
       * Esto filtraba por `createdAt`, que es cuándo el espejo trajo el pedido. Y el
       * espejo trae muchos días de una vez, así que todos nacían con la fecha de hoy:
       * pedir cualquier otro día devolvía CERO pedidos aunque estuvieran ahí. Se mantiene
       * `createdAt` de respaldo para los que entraron antes de que se guardara la buena.
       */
      ...(porDia ? [{ OR: [{ orderDate: porDia }, { orderDate: null, createdAt: porDia }] }] : []),
    ],
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      // Los nulos al final: en Postgres un nulo en un DESC va PRIMERO y los pedidos sin
      // fecha se plantarían en lo alto de la lista, delante de los de hoy.
      orderBy: [{ orderDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: TOPE,
      select: {
        id: true,
        orderDate: true,
        createdAt: true,
        operationNumber: true,
        customerName: true,
        address: true,
        endAddress: true,
        endLat: true,
        endLng: true,
        weight: true,
        deliveryPrice: true,
        deliveryDistanceKm: true,
        items: true,
        estado: true,
        archivado: true,
        requiereDomicilio: true,
        pedidoCosto: true,
        municipio: true,
        vendedor: true,
      },
    }),
  ])

  /**
   * Los filtros que aún se aplican aquí: los que no son del catálogo.
   *
   * La distancia y el costo son de delivery —los calcula él— y no tienen sitio en
   * `filtrosPedido`, que describe el pedido tal como viene de PEDIDO.
   */
  const numero = (v: string | null) => {
    if (v == null || v.trim() === '') return null

    const n = Number(v)

    return Number.isFinite(n) ? n : null
  }
  const kmMax = numero(params.get('kmMax'))
  const costoMin = numero(params.get('costoMin'))

  const filtered = orders.filter((o) => {
    // Sin distancia medida no se descarta por distancia: no saberla no es estar lejos.
    if (kmMax != null && o.deliveryDistanceKm != null && o.deliveryDistanceKm > kmMax) return false
    // Por el costo de PEDIDO, que es el que se cobra. `deliveryPrice` es una estimación
    // propia que ya no se usa para cobrar, y filtrar por ella escondía pedidos reales.
    if (costoMin != null && (o.pedidoCosto ?? 0) < costoMin) return false

    return true
  })

  // Se dice si se cortó. Una lista recortada en silencio se lee como "esto es todo lo que
  // hay", y quien arma la ruta da por hecho que no falta ningún pedido.
  return NextResponse.json({
    orders: filtered,
    total,
    truncated: total > orders.length,
  })
}
