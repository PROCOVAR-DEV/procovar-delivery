import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function ensureAdmin(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null }
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), user: null }
  return { error: null, user }
}

export async function GET(req: NextRequest) {
  const auth = ensureAdmin(req)
  if (auth.error) return auth.error

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      branchId: true,
      branch: { select: { id: true, name: true } },
      _count: {
        select: {
          orders: true,
          routes: true,
          vehicles: true,
        }
      }
    }
  })

  return NextResponse.json(users)
}

/**
 * Aquí ya no se crean cuentas.
 *
 * Las personas viven en el sistema de accesos de Procovar; esta tabla es su
 * reflejo, y se rellena sola cuando alguien entra. Crear una cuenta aquí daría
 * una persona que no existe en ninguna otra aplicación y que no podría entrar,
 * porque el login ya no está en delivery.
 *
 * Las cuentas que ya había NO se tocan: llevan colgados los pedidos, las rutas
 * y los vehículos que cada uno creó. Se emparejan con las de accesos **por el
 * correo**, así que quien ya trabaje aquí tiene que tener en accesos el mismo
 * correo que tiene en esta lista, o su trabajo se quedará en la ficha antigua.
 */
