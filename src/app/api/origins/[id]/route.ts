import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const origin = await prisma.savedOrigin.findFirst({
    where: { id, ...scopeWhere(scope) },
  })

  if (!origin) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  await prisma.savedOrigin.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
