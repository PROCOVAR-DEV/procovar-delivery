import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const existing = await prisma.branch.findFirst({ where: { id, creatorId: user.id as string } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { name, address, lat, lng, areaKm2, externalId } = await req.json()

  const updated = await prisma.branch.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(address !== undefined && { address: address || null }),
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng }),
      ...(areaKm2 !== undefined && { areaKm2 }),
      ...(externalId !== undefined && { externalId: externalId || null }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const existing = await prisma.branch.findFirst({ where: { id, creatorId: user.id as string } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  // Detach members first to satisfy the FK, then delete the branch.
  await prisma.user.updateMany({ where: { branchId: id }, data: { branchId: null } })
  await prisma.branch.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
