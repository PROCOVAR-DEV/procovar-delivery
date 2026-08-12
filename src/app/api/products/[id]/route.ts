import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { esSuperAdmin } from '@/lib/es-super-admin'

export const dynamic = 'force-dynamic'

/*
 * El catálogo lo LEE todo el mundo y lo TOCA solo el Super Admin.
 *
 * Los productos vienen del almacén de datos: son los mismos para toda la
 * empresa, así que un borrado aquí se los quita a las ocho sucursales a la vez.
 * Eso no es cosa de quien manda en una.
 */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!esSuperAdmin(user)) {
    return NextResponse.json({ error: 'Solo el Super Admin puede tocar el catálogo' }, { status: 403 })
  }

  const existing = await prisma.product.findFirst({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { name, weight, packaging, unitsPerPackage, category } = await req.json()

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(weight !== undefined && { weight: Number(weight) || 0 }),
      ...(packaging !== undefined && { packaging: packaging?.toString().trim() || null }),
      ...(unitsPerPackage !== undefined && { unitsPerPackage: unitsPerPackage != null && unitsPerPackage !== '' ? Number(unitsPerPackage) : null }),
      ...(category !== undefined && { category: category?.toString().trim() || null }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!esSuperAdmin(user)) {
    return NextResponse.json({ error: 'Solo el Super Admin puede tocar el catálogo' }, { status: 403 })
  }

  const existing = await prisma.product.findFirst({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  await prisma.product.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
