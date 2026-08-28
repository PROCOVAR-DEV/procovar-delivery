import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope } from '@/lib/scope'
import { tasaDeAlmacen, tasaDeSucursal } from '@/lib/tasaCambio'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasa — la tasa CUP de la sucursal que se está mirando.
 *
 * La necesita la barra de arriba para poder pasar de USD a CUP. La mantiene Accesos, por
 * sucursal, sacándola de Entrega; aquí sólo se pregunta.
 *
 * **Sin tasa no se puede pasar a CUP, y eso es a propósito.** Convertir un importe de
 * Granma con la tasa de La Habana da un número creíble que nadie cuestiona y que aparece
 * en la caja. Se prefiere no ofrecer CUP —diciendo de qué sucursal falta— a ofrecerlo con
 * la tasa de otra provincia.
 *
 * Con «todas las sucursales» elegido tampoco hay CUP: no hay UNA tasa que valga para las
 * ocho, y elegir una cualquiera sería exactamente el error que esto evita.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)

  if (!scope.branchId) {
    /**
     * Viendo todas las sucursales: se dice cuántas tienen tasa y cuántas no.
     *
     * No sirve para convertir, pero sí para saber que falta ponerlas — que es la única
     * acción posible desde aquí.
     */
    const sucursales = await prisma.branch.findMany({
      where: { externalId: { not: null } },
      select: { name: true, externalId: true },
    })
    const tasas = await Promise.all(sucursales.map((s) => tasaDeSucursal(s.externalId)))

    return NextResponse.json({
      tasa: null,
      motivo: 'varias-sucursales',
      aviso: 'Elegí una sucursal arriba para ver los importes en CUP: cada una tiene su tasa.',
      sinTasa: sucursales.filter((_, i) => !tasas[i]).map((s) => s.name),
    })
  }

  const t = await tasaDeAlmacen(scope.branchId)
  const sucursal = await prisma.branch.findUnique({
    where: { id: scope.branchId },
    select: { name: true, externalId: true },
  })

  if (!t) {
    return NextResponse.json({
      tasa: null,
      motivo: 'sin-tasa',
      sucursal: sucursal?.name ?? null,
      // Se dice DE QUÉ sucursal falta: «no hay tasa» a secas hace pensar que no hay
      // ninguna en el sistema, y manda a buscar el problema al sitio equivocado.
      aviso: `${sucursal?.name ?? 'Esta sucursal'} no tiene tasa de cambio todavía: los importes sólo se pueden ver en USD.`,
    })
  }

  return NextResponse.json({
    tasa: t.cupPorUsd,
    fuente: t.fuente,
    traidoAt: t.traidoAt,
    fresca: t.fresca,
    sucursal: sucursal?.name ?? null,
    // Vieja no es lo mismo que ausente: se puede usar, pero hay que decir de cuándo es.
    aviso: t.fresca ? null : `La tasa es del ${new Date(t.traidoAt).toLocaleDateString('es')} y puede estar desfasada.`,
  })
}
