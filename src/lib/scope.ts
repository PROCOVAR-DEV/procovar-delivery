import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AuthUser } from '@/lib/auth'

export interface Scope {
  /** Dueño de los datos (la "organización"): el creador de la sucursal. Para el admin
   *  es él mismo; para un usuario de sucursal, el creador de su sucursal. */
  ownerId: string
  /** Sucursal a la que se limita la consulta. null = todas (solo admin sin filtro). */
  branchId: string | null
}

/**
 * Resuelve el alcance (scope) de una petición para el modelo multi-sucursal de delivery:
 *  - Usuario de SUCURSAL (tiene branchId): forzado a SU sucursal; el dueño de los datos es
 *    el creador de esa sucursal (la organización), así ve los datos de su sucursal aunque
 *    los haya creado el admin.
 *  - ADMIN (sin branchId): ve TODO; opcionalmente filtra por la sucursal elegida en el
 *    header `x-sucursal-id` (el selector del panel). Sin header = todas.
 */
export async function resolveScope(req: NextRequest, user: AuthUser): Promise<Scope> {
  if (user.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: user.branchId }, select: { creatorId: true } })
    return { ownerId: b?.creatorId ?? user.id, branchId: user.branchId }
  }
  const h = req.headers.get('x-sucursal-id')?.trim()
  return { ownerId: user.id, branchId: h && h.length ? h : null }
}

/** where de Prisma para scopear por dueño + (opcional) sucursal. */
export function scopeWhere(scope: Scope): { userId: string; branchId?: string } {
  return { userId: scope.ownerId, ...(scope.branchId ? { branchId: scope.branchId } : {}) }
}
