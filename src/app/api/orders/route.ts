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
        stopOrder: true,
        estado: true,
        archivado: true,
        fechaComprometida: true,
        requiereDomicilio: true,
        pedidoCosto: true,
        facturaEstado: true,
        facturaNumero: true,
        // Lo que pesa la FACTURA, que no siempre es lo que pesa el pedido. Es lo que de
        // verdad sube al camión, así que es lo que hay que ver al cargar.
        pesoFacturado: true,
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
 * POST /api/orders — un pedido A MANO.
 *
 * Casi todos entran solos desde PEDIDO. Éste es para lo que no pasa por ahí: un cliente
 * que llama, una entrega que se arma en el momento. Hace falta, y quitarlo dejó a la
 * gente sin forma de meter esos.
 *
 * Lo que NO hace: ponerle precio de domicilio. Eso lo pone el repartidor desde Entrega,
 * igual que en los que vienen de PEDIDO — un pedido manual nace «sin cotizar», y así se
 * ve. Sí calcula el PESO, que sale del catálogo de Ventra y es lo que decide en qué
 * camión cabe.
 */
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    customerId?: string
    customerName?: string
    address?: string
    phone?: string
    lat?: number
    lng?: number
    branchId?: string
    municipio?: string
    notes?: string
    items?: Array<{ productId?: string; sku?: string; name?: string; packs?: number; quantity?: number }>
  } | null

  if (!body) return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })

  /**
   * La sucursal: la suya si tiene, la de la barra si no.
   *
   * Un pedido tiene que nacer EN una sucursal: de ella salen el almacén desde el que se
   * mide, los vehículos y la ruta. Sin ella el pedido existe pero no se puede repartir.
   */
  const suya = await sucursalDeLaPersona(user)
  const scope = await resolveScope(req, user)

  /**
   * Quien lleva UNA sucursal no puede crear en otra, y se le dice.
   *
   * La versión anterior se limitaba a usar la suya, ignorando en silencio la que pedía:
   * el pedido se creaba, pero en otro sitio del que creía quien lo estaba metiendo, y no
   * aparecía donde iba a buscarlo.
   */
  if (suya && body.branchId && body.branchId !== suya) {
    return NextResponse.json({ error: 'Sin acceso a esa sucursal' }, { status: 403 })
  }

  const branchId = suya ?? body.branchId ?? scope.branchId

  if (!branchId) {
    return NextResponse.json({ error: 'Falta la sucursal: elegí una arriba o mandá branchId' }, { status: 400 })
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, externalId: true, creatorId: true } })

  if (!branch) return NextResponse.json({ error: 'Esa sucursal no existe' }, { status: 400 })

  // El cliente: uno del espejo (con su geo ya puesta) o los datos a mano.
  const cliente = body.customerId
    ? await prisma.customer.findUnique({ where: { id: body.customerId } })
    : null

  const nombre = (cliente?.name ?? body.customerName ?? '').trim()
  const lat = cliente?.lat ?? (Number.isFinite(Number(body.lat)) ? Number(body.lat) : null)
  const lng = cliente?.lng ?? (Number.isFinite(Number(body.lng)) ? Number(body.lng) : null)

  if (!nombre) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 })
  if (lat == null || lng == null) {
    // Sin coordenadas no hay ruta ni domicilio: el pedido entraría para no poder usarse.
    return NextResponse.json({ error: 'Falta la ubicación del cliente (lat/lng)' }, { status: 400 })
  }

  /**
   * El peso, del catálogo de Ventra.
   *
   * `weight` de cada producto es el de UNA unidad de venta (el pack/caja), así que se
   * multiplica por los packs — no por las unidades sueltas, que daría una cifra
   * disparatada. Un producto sin peso en Ventra suma 0 y se dice cuántos son.
   */
  const entradas = Array.isArray(body.items) ? body.items : []
  const ids = entradas.map((i) => i.productId).filter(Boolean) as string[]
  const productos = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } } })
    : []
  const porId = new Map(productos.map((p) => [p.id, p]))

  let peso = 0
  let sinPeso = 0

  const items = entradas.map((i) => {
    const p = i.productId ? porId.get(i.productId) : undefined
    const packs = Number(i.packs) > 0 ? Number(i.packs) : 1
    const unitario = p?.weight ?? 0
    const linea = Number((unitario * packs).toFixed(3))

    if (!unitario) sinPeso++
    peso += linea

    return {
      productId: p?.id ?? null,
      sku: p?.sku ?? i.sku ?? null,
      name: p?.name ?? i.name ?? 'Producto',
      packs,
      quantity: Number(i.quantity) > 0 ? Number(i.quantity) : packs,
      unitWeightKg: unitario || null,
      weightKg: linea || null,
    }
  })

  /**
   * El COSTO, con la fórmula de Entrega.
   *
   * Se calcula aquí y no se deja en blanco porque un pedido metido a mano se reparte hoy:
   * dejarlo «sin cotizar» obliga a abrir la APK sólo para ponerle precio. Y se calcula
   * con la MISMA fórmula que usa el repartidor —tarifa base × distancia × peso, distancia
   * en línea recta del almacén al cliente— para que el mismo reparto no valga una cosa
   * aquí y otra en el teléfono.
   *
   * La distancia sale del ALMACÉN PRINCIPAL de la sucursal, que es desde donde se mide
   * (los almacenes se gestionan en esta misma aplicación). Sin almacén con punto, o sin
   * tarifa o tasa de esa sucursal, se queda sin precio y se DICE por qué: un cero se suma
   * y se lee como «este domicilio es gratis».
   */
  let costo: ReturnType<typeof costoDomicilioEntrega> = null
  let porQueSinCosto: string | null = null

  try {
    const codigo = branch.externalId
    const tasa = codigo ? await tasaDeSucursal(codigo) : null
    const almacenes = codigo ? await almacenesDeSucursal(codigo) : []
    const almacen = almacenes.find((a) => a.principal && a.latitud != null && a.longitud != null)
      ?? almacenes.find((a) => a.latitud != null && a.longitud != null)

    if (!almacen) porQueSinCosto = 'la sucursal no tiene un almacén con coordenadas'
    else if (!tasa?.cupPorUsd) porQueSinCosto = `no hay tasa de cambio de ${codigo} en Accesos`
    else if (!tasa?.tarifaBase) porQueSinCosto = `no hay tarifa base de ${codigo} en Entrega`
    else {
      const km = distanciaHaversineKm(almacen.latitud as number, almacen.longitud as number, lat, lng)

      costo = costoDomicilioEntrega(tasa.tarifaBase, tasa.cupPorUsd, km, peso)
    }
  } catch (e) {
    porQueSinCosto = `no se pudo calcular: ${(e as Error).message}`
  }

  const order = await prisma.order.create({
    data: {
      source: 'manual',
      customerName: nombre,
      customerPhone: (cliente?.phone ?? body.phone ?? null) || null,
      address: (cliente?.address ?? body.address ?? nombre) || nombre,
      endAddress: cliente?.address ?? body.address ?? null,
      endLat: lat,
      endLng: lng,
      lat,
      lng,
      municipio: cliente?.municipio ?? body.municipio ?? null,
      weight: Number(peso.toFixed(3)),
      items: items as unknown as Prisma.InputJsonValue,
      // La copia en texto, para poder buscar por producto igual que en los importados.
      productosTexto: items.map((i) => i.name).filter(Boolean).join(' · ') || null,
      notes: body.notes?.trim() || null,
      // El costo va en `pedidoCosto` como el de los demás: es el que se cobra, calculado
      // con la fórmula de Entrega. El repartidor puede corregirlo desde la APK.
      pedidoCosto: costo?.usd ?? null,
      deliveryDistanceKm: costo?.distanciaKm ?? null,
      requiereDomicilio: true,
      orderDate: new Date(),
      branchId: branch.id,
      userId: branch.creatorId,
      sucursalCodigo: branch.externalId,
    },
  })

  const avisos = [
    sinPeso ? `${sinPeso} producto(s) sin peso en Ventra: el peso total se queda corto.` : null,
    costo == null ? `Sin costo de domicilio: ${porQueSinCosto ?? 'faltan datos'}.` : null,
  ].filter(Boolean)

  return NextResponse.json({ order, costo, aviso: avisos.join(' ') || null })
}
