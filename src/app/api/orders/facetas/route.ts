import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * Con qué se puede filtrar: los municipios y los vendedores que EXISTEN de verdad.
 *
 * Antes los sacaba la pantalla de la lista que ya tenía. Ahora la lista viene paginada
 * —son 50.000 pedidos— y sacarlos de una página daría un desplegable distinto en cada
 * página, ofreciendo justo los municipios que ya se están viendo.
 *
 * Se piden aparte y se cachean: cambian cuando entra un vendedor nuevo, no en cada
 * consulta.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const where = scopeWhere(scope)

  // `groupBy` y no `findMany` + Set: la base sabe hacer un DISTINCT sin traerse 50.000
  // filas para tirarlas.
  const [municipios, vendedores, sucursales] = await Promise.all([
    prisma.order.groupBy({
      by: ['municipio'],
      where: { ...where, municipio: { not: null } },
      _count: { _all: true },
      orderBy: { municipio: 'asc' },
    }),
    prisma.order.groupBy({
      by: ['vendedor'],
      where: { ...where, vendedor: { not: null } },
      _count: { _all: true },
      orderBy: { vendedor: 'asc' },
    }),
    // Las sucursales que TIENEN pedidos, con cuántos. Sin esto no había forma de saber
    // de qué sucursal es cada pedido ni de quedarse con los de una.
    prisma.order.groupBy({
      by: ['branchId'],
      where: { ...where, branchId: { not: null } },
      _count: { _all: true },
    }),
  ])

  const nombres = new Map(
    (await prisma.branch.findMany({ select: { id: true, name: true, externalId: true } }))
      .map((b) => [b.id, b.externalId ? `${b.name} (${b.externalId})` : b.name]),
  )

  // Con el conteo: saber que un municipio tiene tres pedidos y otro mil ahorra elegir el
  // equivocado y volver.
  return NextResponse.json({
    municipios: municipios.map((m) => ({ valor: m.municipio as string, pedidos: m._count._all })),
    vendedores: vendedores.map((v) => ({ valor: v.vendedor as string, pedidos: v._count._all })),
    sucursales: sucursales
      .map((s) => ({
        valor: s.branchId as string,
        nombre: nombres.get(s.branchId as string) ?? 'Sin sucursal',
        pedidos: s._count._all,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
  })
}
