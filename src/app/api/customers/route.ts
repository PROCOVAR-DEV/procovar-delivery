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
