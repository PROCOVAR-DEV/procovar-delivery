import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Clientes espejados de PEDIDO (SOLO geolocalizados) para el selector al crear una
// orden: elegís el cliente y ya trae su geo → sale el costo, sin recrear el cliente.
// El mirror lo mantiene sync-queue.mjs automáticamente (no hay import manual).
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''

  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' }, take: 500 })
  const filtered = q
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.address || '').toLowerCase().includes(q) ||
          (c.municipio || '').toLowerCase().includes(q),
      )
    : customers

  return NextResponse.json({ count: filtered.length, customers: filtered })
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
