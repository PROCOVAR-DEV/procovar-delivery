import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
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
const TOPE = 200

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

  if (scope.branchId) {
    const b = await prisma.branch.findUnique({
      where: { id: scope.branchId },
      select: { externalId: true },
    })

    if (b?.externalId) {
      porSucursal = { OR: [{ sucursalCodigo: b.externalId }, { sucursalCodigo: null }] }
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

  return NextResponse.json({
    count: customers.length,
    total,
    pagina,
    porPagina: TOPE,
    paginas: Math.max(1, Math.ceil(total / TOPE)),
    truncated: total > customers.length,
    customers,
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
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  if (!name) return NextResponse.json({ error: 'Falta el nombre del cliente' }, { status: 400 })
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Falta la geolocalización (lat/lng) del cliente' }, { status: 400 })
  }

  const customer = await prisma.customer.create({
    data: {
      source: null,
      externalId: null,
      name,
      phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
      address: typeof body.address === 'string' ? body.address.trim() || null : null,
      municipio: typeof body.municipio === 'string' ? body.municipio.trim() || null : null,
      zona: typeof body.zona === 'string' ? body.zona.trim() || null : null,
      lat,
      lng,
    },
  })

  return NextResponse.json({ customer }, { status: 201 })
}
