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
const TOPE = 500

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const q = params.get('q')?.trim() || ''

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
        ],
      }
    : {}

  const where = { AND: [porSucursal, busqueda].filter((x) => Object.keys(x).length > 0) }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
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
        syncedAt: true,
      },
    }),
  ])

  return NextResponse.json({ count: customers.length, total, truncated: total > customers.length, customers })
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
