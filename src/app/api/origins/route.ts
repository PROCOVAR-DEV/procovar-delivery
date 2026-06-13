import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = new URL(req.url).searchParams.get('branchId')

  const origins = await prisma.savedOrigin.findMany({
    where: {
      userId: user.id,
      ...(branchId ? { branchId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { branch: { select: { id: true, name: true } } },
  })

  return NextResponse.json(origins)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, address, lat, lng, branchId } = await req.json()

  if (!name || !address || lat == null || lng == null) {
    return NextResponse.json({ error: 'Faltan campos requeridos: name, address, lat, lng' }, { status: 400 })
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'lat y lng deben ser números' }, { status: 400 })
  }

  // Validate the branch belongs to this user before linking (prevents IDOR on the FK).
  let validBranchId: string | null = null
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, OR: [{ creatorId: user.id }, { members: { some: { id: user.id } } }] },
      select: { id: true },
    })
    if (!branch) {
      return NextResponse.json({ error: 'Sucursal no válida' }, { status: 403 })
    }
    validBranchId = branch.id
  }

  const origin = await prisma.savedOrigin.create({
    data: { name, address, lat, lng, userId: user.id, branchId: validBranchId },
  })

  return NextResponse.json(origin, { status: 201 })
}
