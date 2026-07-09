import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { warehouse } from '@/lib/warehouse'

export const dynamic = 'force-dynamic'

/**
 * POST /api/products/import-warehouse — Trae el catálogo del Data Warehouse
 * (/products/weights) y lo inserta/actualiza en el catálogo local `Product` de delivery,
 * para que se vea en la pantalla de Productos y esté disponible en el armador de rutas.
 * Idempotente: upsert por nombre (case-insensitive) dentro del usuario.
 */
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let list
  try {
    list = await warehouse.productWeights()
  } catch (e) {
    return NextResponse.json(
      { error: 'No se pudo leer el catálogo del warehouse (¿VPN?): ' + (e as Error).message },
      { status: 502 },
    )
  }

  const userId = user.id as string
  const existentes = await prisma.product.findMany({ where: { userId }, select: { id: true, name: true } })
  const byName = new Map(existentes.map((p) => [p.name.trim().toLowerCase(), p.id]))

  let creados = 0
  let actualizados = 0
  for (const p of list) {
    const name = (p.name || '').trim()
    if (!name) continue
    const weight = p.weightKg == null ? 0 : p.weightKg
    const data = { name, weight, category: p.category || null, packaging: p.unit || null }
    const existingId = byName.get(name.toLowerCase())
    if (existingId) {
      await prisma.product.update({ where: { id: existingId }, data })
      actualizados++
    } else {
      await prisma.product.create({ data: { ...data, userId } })
      creados++
    }
  }

  const conPeso = list.filter((p) => p.weightKg != null).length
  return NextResponse.json({
    total: list.length,
    creados,
    actualizados,
    sinPeso: list.length - conPeso,
  })
}
