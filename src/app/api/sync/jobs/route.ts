import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sync/jobs — lista PAGINADA y FILTRABLE de la cola de sincronización (SyncJob).
 * Filtros: ?status=pending|processing|done|error|skipped  ·  ?q=<folio o cliente>
 * Paginación: ?page=1&limit=20. Devuelve también los contadores por estado (para las
 * tarjetas), así la tabla y los totales quedan consistentes con el filtro de búsqueda.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') || ''
  const q = (sp.get('q') || '').trim()
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '20', 10) || 20))
  const skip = (page - 1) * limit

  const VALID = ['pending', 'processing', 'done', 'error', 'skipped']

  // El texto (folio/cliente) filtra TODO; el estado solo la lista (para poder ver los
  // contadores de cada estado aunque estés mirando uno solo).
  const textWhere: Prisma.SyncJobWhereInput = q
    ? {
        OR: [
          { folio: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { externalId: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {}
  const listWhere: Prisma.SyncJobWhereInput = {
    ...textWhere,
    ...(status && VALID.includes(status) ? { status } : {}),
  }

  const [rows, total, grouped] = await Promise.all([
    prisma.syncJob.findMany({
      where: listWhere,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      select: {
        externalId: true, folio: true, customerName: true, status: true,
        cost: true, distanceKm: true, error: true, attempts: true, updatedAt: true,
      },
    }),
    prisma.syncJob.count({ where: listWhere }),
    prisma.syncJob.groupBy({ by: ['status'], _count: { _all: true }, where: textWhere }),
  ])

  const counts: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0, skipped: 0 }
  for (const g of grouped) counts[g.status] = g._count._all

  return NextResponse.json({
    jobs: rows,
    counts,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  })
}
