import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere, sucursalDeLaPersona } from '@/lib/scope'
import { esServicio } from '@/lib/servicios'

export const dynamic = 'force-dynamic'

/**
 * El CATÁLOGO, por sucursal y traído solo.
 *
 * Antes era global y se daba de alta a mano —había una pantalla para teclear productos—.
 * Dos problemas: en Ventra el precio y las existencias VARÍAN por sucursal, así que un
 * catálogo único ofrece en Camagüey lo que sólo hay en La Habana y al precio de allá; y
 * un catálogo tecleado se separa del de verdad en cuanto alguien no actualiza.
 *
 * Ahora lo llena el espejo: PEDIDO sondea Ventra cada doce horas y aquí se copia lo que
 * él tiene, que es el MISMO dato con el que se pesa y se cotiza. Sin alta manual.
 */

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const q = params.get('q')?.trim().toLowerCase() || ''

  /**
   * Los de la sucursal que se está mirando.
   *
   * Se acepta un `sucursal` explícito (el código) porque el alta manual de un pedido se
   * hace PARA una sucursal concreta, que puede no ser la de la barra de arriba cuando
   * arriba dice «todas». Sin nada, manda el alcance de siempre.
   */
  const pedida = params.get('sucursal')?.trim().toUpperCase() || ''
  const suya = await sucursalDeLaPersona(user)
  const scope = await resolveScope(req, user)
  const branchId = suya ?? scope.branchId

  let codigo = pedida

  if (!codigo && branchId) {
    const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { externalId: true } })

    codigo = b?.externalId ?? ''
  }

  const products = await prisma.product.findMany({
    where: {
      ...(codigo ? { sucursalCodigo: codigo } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 500,
  })

  /**
   * Lo más transportado primero.
   *
   * Se cuenta sobre los pedidos de la sucursal de quien mira: «lo más movido» tiene que
   * significar algo aquí, no en la empresa entera.
   */
  const orders = await prisma.order.findMany({
    where: scopeWhere(scope),
    select: { items: true },
    take: 2000,
    orderBy: { createdAt: 'desc' },
  })
  const usage: Record<string, number> = {}

  for (const o of orders) {
    const items = (Array.isArray(o.items) ? o.items : []) as Array<{ productId?: string; sku?: string; quantity?: number }>

    for (const it of items) {
      const clave = it?.productId || it?.sku

      if (clave) usage[clave] = (usage[clave] || 0) + (Number(it.quantity) || 0)
    }
  }

  /**
   * Fuera los SERVICIOS.
   *
   * En el catálogo de Ventra viene «ENTREGA A DOMICILIO» —categoría SERV, peso cero— como
   * un producto más, y salía en el buscador al meter un pedido a mano. No es algo que se
   * carga en un camión: es el cobro del reparto. Metido en un pedido, no pesa nada y cobra
   * el reparto dos veces, una en la línea y otra en el domicilio.
   */
  return NextResponse.json(
    products
      .filter((p) => !esServicio(p))
      .map((p) => ({ ...p, usageCount: usage[p.id] || usage[p.sku ?? ''] || 0 })),
  )
}

/**
 * El alta manual se retiró.
 *
 * El catálogo llega de Ventra por el espejo. Un producto tecleado aquí no existe en
 * Ventra: no tiene precio ni existencias de verdad, y en la siguiente pasada convive con
 * el bueno como si fueran dos cosas distintas.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'El catálogo se trae solo de Ventra (a través de PEDIDO). No hay alta manual de productos.',
    },
    { status: 410 },
  )
}
