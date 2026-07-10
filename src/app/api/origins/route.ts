import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = new URL(req.url).searchParams.get('branchId')
  const scope = await resolveScope(req, user)

  const origins = await prisma.savedOrigin.findMany({
    where: {
      // Scopeado al dueño de la sucursal (no al usuario logueado): un admin de sucursal
      // ve los orígenes de su sucursal aunque los haya creado el Super Admin.
      userId: scope.ownerId,
      ...(scope.branchId ? { branchId: scope.branchId } : branchId ? { branchId } : {}),
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

  const scope = await resolveScope(req, user)
  // Un usuario de sucursal solo puede crear orígenes en SU sucursal.
  const targetBranchId = scope.branchId ?? branchId ?? null

  // Validate the branch belongs to this org before linking (prevents IDOR on the FK).
  let validBranchId: string | null = null
  if (targetBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: targetBranchId, OR: [{ creatorId: scope.ownerId }, { members: { some: { id: user.id } } }] },
      select: { id: true },
    })
    if (!branch) {
      return NextResponse.json({ error: 'Sucursal no válida' }, { status: 403 })
    }
    validBranchId = branch.id
  }

  const origin = await prisma.savedOrigin.create({
    data: { name, address, lat, lng, userId: scope.ownerId, branchId: validBranchId },
  })

  return NextResponse.json(origin, { status: 201 })
}
