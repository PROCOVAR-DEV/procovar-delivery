import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branches = await prisma.branch.findMany({
    where: { creatorId: user.id as string },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { members: true, origins: true } } },
  })

  return NextResponse.json(branches)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { name, address, lat, lng, areaKm2, externalId } = await req.json()

  if (!name || lat == null || lng == null) {
    return NextResponse.json({ error: 'Nombre y coordenadas son requeridos' }, { status: 400 })
  }

  const branch = await prisma.branch.create({
    data: {
      name,
      address: address || null,
      lat,
      lng,
      areaKm2: areaKm2 ?? 1,
      // Mapea esta sucursal con la de PEDIDO (necesario para /api/quote y el batch).
      externalId: externalId || null,
      creatorId: user.id as string,
    },
  })

  return NextResponse.json(branch, { status: 201 })
}
