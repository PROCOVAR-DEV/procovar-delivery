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
      // Por SUCURSAL, no por cuenta: un origen es de la sucursal donde está, lo
      // haya guardado quien lo haya guardado.
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

  // Que la sucursal exista y sea una a la que se llegue, para que nadie cuelgue
  // un origen en la sucursal de otro mandando su identificador en la petición.
  //
  // Se comprueba contra el ALCANCE. Antes se miraba el creador de la sucursal,
  // y como las ocho las creó el Super Admin, esa comprobación no comprobaba nada.
  let validBranchId: string | null = null
  if (targetBranchId) {
    const branch = await prisma.branch.findFirst({
      where: scope.branchId
        ? { id: scope.branchId }
        : { id: targetBranchId },
      select: { id: true },
    })
    if (!branch) {
      return NextResponse.json({ error: 'Sucursal no válida' }, { status: 403 })
    }
    validBranchId = branch.id
  }

  const origin = await prisma.savedOrigin.create({
    // `userId` deja constancia de quién lo guardó. No filtra nada.
    data: { name, address, lat, lng, userId: scope.actorId, branchId: validBranchId },
  })

  return NextResponse.json(origin, { status: 201 })
}
