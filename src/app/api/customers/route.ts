import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { almacenesDeSucursal } from '@/lib/almacenes'
import { distanciaHaversineKm } from '@/lib/domicilioEntrega'
import { resolveScope } from '@/lib/scope'

export const dynamic = 'force-dynamic'

// Clientes espejados de PEDIDO (SOLO geolocalizados) para el selector al crear una
// orden: elegís el cliente y ya trae su geo → sale el costo, sin recrear el cliente.
// El mirror lo mantiene sync-queue.mjs automáticamente (no hay import manual).
/**
 * Los clientes del espejo, buscados EN LA BASE.
 *
 * Esto pedía los 500 primeros por nombre y filtraba después, en memoria. O sea que
 * buscar un cliente que empezara por «S» no encontraba nada: no había entrado en los 500
 * primeros, y la pantalla decía que no existe un cliente que sí está. Tampoco se acotaba
 * por sucursal: quien lleva una veía los clientes de todas.
 *
 * Ahora la búsqueda la hace la base, el alcance se aplica antes, y el tope es del
 * servidor. Se devuelve además cuántos hay en total, para que la pantalla pueda decir
 * "500 de 2.480" en vez de dar a entender que ésos son todos.
 */
/**
 * Cincuenta por página, no doscientos.
 *
 * Con doscientas filas los botones de página quedaban al final de un desplazamiento
 * larguísimo: la gente daba por hecho que no había paginación. Cincuenta caben en dos
 * pantallazos.
 */
const TOPE = 50

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const q = params.get('q')?.trim() || ''
  // Los mismos filtros que la lista de pedidos ofrece, con lo que un cliente tiene.
  const municipio = params.get('municipio')?.trim() || ''
  const sucursal = params.get('sucursalCodigo')?.trim() || ''
  const zona = params.get('zona')?.trim() || ''
  // De dónde salió: del espejo de PEDIDO o dado de alta a mano aquí.
  const origen = params.get('origen')?.trim() || ''
  const vendedor = params.get('vendedor')?.trim() || ''
  /** `1` sólo los que tienen teléfono, `0` sólo los que no. Sin él, los dos. */
  const telefono = params.get('telefono')?.trim() || ''
  /**
   * A cuántos kilómetros del ALMACÉN como mucho.
   *
   * Es filtrar por geolocalización de verdad: «los clientes que caen a menos de 10 km»
   * es con lo que se decide a quién meter en la ruta de hoy. Se mide en línea recta desde
   * el almacén principal de la sucursal, igual que el domicilio.
   */
  const kmMax = Number(params.get('kmMax'))
  const pagina = Math.max(1, Number(params.get('pagina')) || 1)

  /**
   * Por sucursal, con el CÓDIGO, que es lo que guarda el espejo.
   *
   * `Customer` no tiene `branchId`: guarda `sucursalCodigo`, el código de la sucursal en
   * PEDIDO. Así que el alcance se traduce a ese código. Los clientes MANUALES (los que no
   * vinieron de PEDIDO) no tienen código y se ven siempre: son de quien los dio de alta.
   */
  const scope = await resolveScope(req, user)
  let porSucursal: Record<string, unknown> = {}
  /** El código de la sucursal que se está mirando: hace falta para medir desde su almacén. */
  let sucursalDelAlcance: string | null = sucursal || null

  if (scope.branchId) {
    const b = await prisma.branch.findUnique({
      where: { id: scope.branchId },
      select: { externalId: true },
    })

    if (b?.externalId) {
      porSucursal = { OR: [{ sucursalCodigo: b.externalId }, { sucursalCodigo: null }] }
      sucursalDelAlcance = b.externalId
    }
  }

  const busqueda = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { address: { contains: q, mode: 'insensitive' as const } },
          { municipio: { contains: q, mode: 'insensitive' as const } },
          { zona: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q, mode: 'insensitive' as const } },
          // Por su CÓDIGO, que es como lo nombra la gente cuando llama.
          { codigo: { contains: q, mode: 'insensitive' as const } },
          { vendedor: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}

  /**
   * El almacén desde el que se mide, y la caja que lo rodea.
   *
   * Un grado de latitud son ~111 km en cualquier sitio; uno de longitud se encoge con el
   * coseno de la latitud. Con eso se saca un cuadrado que contiene con seguridad al
   * círculo de `kmMax`, y lo que sobra se descarta midiendo de verdad.
   */
  let caja: { lat: { gte: number; lte: number }; lng: { gte: number; lte: number } } | null = null
  let almacen: { latitud: number; longitud: number } | null = null

  if (Number.isFinite(kmMax) && kmMax > 0 && sucursalDelAlcance) {
    const lista = await almacenesDeSucursal(sucursalDelAlcance).catch(() => [])
    const bueno = lista.find((a) => a.principal && a.latitud != null) ?? lista.find((a) => a.latitud != null)

    if (bueno?.latitud != null && bueno.longitud != null) {
      almacen = { latitud: bueno.latitud, longitud: bueno.longitud }
      const gradosLat = kmMax / 111
      const gradosLng = kmMax / (111 * Math.max(0.1, Math.cos((bueno.latitud * Math.PI) / 180)))

      caja = {
        lat: { gte: bueno.latitud - gradosLat, lte: bueno.latitud + gradosLat },
        lng: { gte: bueno.longitud - gradosLng, lte: bueno.longitud + gradosLng },
      }
    }
  }

  const where = {
    AND: [
      porSucursal,
      busqueda,
      municipio ? { municipio } : {},
      sucursal ? { sucursalCodigo: sucursal } : {},
      zona ? { zona } : {},
      origen === 'pedido' ? { source: 'pedido' } : {},
      origen === 'manual' ? { source: null } : {},
      vendedor ? { vendedor } : {},
      // Sin teléfono no se le puede avisar de que va el reparto: es una carencia real y
      // por eso se puede listar.
      telefono === '1' ? { phone: { not: null } } : {},
      telefono === '0' ? { OR: [{ phone: null }, { phone: '' }] } : {},
      /**
       * Y por distancia al almacén, con una CAJA antes de medir.
       *
       * Medir la distancia exacta de siete mil clientes en cada consulta es trabajo que
       * la base no puede hacer con un índice. Se acota primero con un cuadrado de
       * latitudes y longitudes —eso sí lo resuelve el índice— y la distancia exacta se
       * comprueba después, sobre las pocas que quedan.
       */
      ...(caja ? [caja] : []),
    ].filter((x) => Object.keys(x).length > 0),
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (pagina - 1) * TOPE,
      take: TOPE,
      select: {
        id: true,
        source: true,
        externalId: true,
        name: true,
        phone: true,
        address: true,
        municipio: true,
        zona: true,
        lat: true,
        lng: true,
        sucursalCodigo: true,
        codigo: true,
        vendedor: true,
        syncedAt: true,
      },
    }),
  ])

  /**
   * Con qué se puede filtrar: los municipios y las sucursales que EXISTEN.
   *
   * Salen de la base entera y no de la página que se ve, que ofrecería justo los
   * municipios que ya se están mirando.
   */
  const [municipios, sucursales, zonas, vendedores, sinTelefono] = await Promise.all([
    prisma.customer.groupBy({
      by: ['municipio'],
      where: { ...porSucursal, municipio: { not: null } },
      _count: { _all: true },
      orderBy: { municipio: 'asc' },
    }),
    prisma.customer.groupBy({
      by: ['sucursalCodigo'],
      where: { ...porSucursal, sucursalCodigo: { not: null } },
      _count: { _all: true },
      orderBy: { sucursalCodigo: 'asc' },
    }),
    prisma.customer.groupBy({
      by: ['zona'],
      where: { ...porSucursal, zona: { not: null } },
      _count: { _all: true },
      orderBy: { zona: 'asc' },
    }),
    // Los vendedores que TIENEN clientes aquí. Es el filtro que más se pide: «los míos».
    prisma.customer.groupBy({
      by: ['vendedor'],
      where: { ...porSucursal, vendedor: { not: null } },
      _count: { _all: true },
      orderBy: { vendedor: 'asc' },
    }),
    // Cuántos no tienen teléfono: sin él no se les puede avisar de que va el reparto.
    prisma.customer.count({ where: { ...porSucursal, OR: [{ phone: null }, { phone: '' }] } }),
  ])

  /**
   * La distancia exacta, sobre lo que la caja dejó pasar.
   *
   * La caja mete de más en las esquinas del cuadrado; medir aquí lo quita. Se mide sólo
   * sobre una página, así que cuesta nada.
   */
  const conDistancia = almacen
    ? customers
        .map((c) => ({
          ...c,
          kmDelAlmacen: Number(
            distanciaHaversineKm(almacen.latitud, almacen.longitud, c.lat, c.lng).toFixed(2),
          ),
        }))
        .filter((c) => c.kmDelAlmacen <= kmMax)
    : customers

  return NextResponse.json({
    count: conDistancia.length,
    total,
    pagina,
    porPagina: TOPE,
    paginas: Math.max(1, Math.ceil(total / TOPE)),
    truncated: total > customers.length,
    customers: conDistancia,
    // Se dice desde dónde se midió: «a 10 km» de un almacén y de otro no es lo mismo.
    almacenDeReferencia: almacen,
    municipios: municipios.map((m) => ({ valor: m.municipio as string, clientes: m._count._all })),
    sucursales: sucursales.map((s) => ({ valor: s.sucursalCodigo as string, clientes: s._count._all })),
    zonas: zonas.map((z) => ({ valor: z.zona as string, clientes: z._count._all })),
    vendedores: vendedores.map((v) => ({ valor: v.vendedor as string, clientes: v._count._all })),
    sinTelefono,
  })
}

// Crea un cliente MANUAL (source=null) desde delivery — para un cliente que no vino de
// PEDIDO. Igual que las orders manuales. Requiere geo (lat/lng): sin coordenadas no se
// cotiza. El sync de PEDIDO nunca toca estos (solo borra source="pedido").
/**
 * Aquí estaba `POST /api/customers`: el alta de un cliente A MANO.
 *
 * Se quitó el 03/09/2026, con el alta de pedidos a mano. Los clientes son de PEDIDO y
 * llegan aquí por el espejo; uno creado aquí no existía allí, así que ningún pedido suyo
 * podía apuntarle y acababa duplicando al que ya estaba con otro nombre.
 *
 * La lista sigue: se pueden ver y buscar. Lo que no se puede es inventar uno.
 */
