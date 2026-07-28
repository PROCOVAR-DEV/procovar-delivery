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

  // Fijar/cambiar las coordenadas = el usuario definió el punto de partida real.
  const setsOrigin = lat !== undefined || lng !== undefined

  const updated = await prisma.branch.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(address !== undefined && { address: address || null }),
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng }),
      ...(areaKm2 !== undefined && { areaKm2 }),
      ...(externalId !== undefined && { externalId: externalId || null }),
      ...(setsOrigin && { originConfigured: true }),
    },
  })

  // Backfill del PUNTO DE PARTIDA: si la sucursal tiene coords pero 0 puntos de partida,
  // crea el por defecto desde su ubicación (igual que al crear). Cubre sucursales viejas
  // que quedaron en "0": al re-guardarlas ya les queda su punto de partida.
  if (updated.lat != null && updated.lng != null) {
    const originCount = await prisma.savedOrigin.count({ where: { branchId: id } })
    if (originCount === 0) {
      await prisma.savedOrigin.create({
        data: {
          name: updated.name,
          address: updated.address || `${updated.lat}, ${updated.lng}`,
          lat: updated.lat,
          lng: updated.lng,
          userId: user.id as string,
          branchId: id,
        },
      })
    }
  }

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
