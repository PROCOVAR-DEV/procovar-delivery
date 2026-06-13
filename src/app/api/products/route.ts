import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface ProductInput {
  name: string
  weight?: number
  packaging?: string | null
  unitsPerPackage?: number | null
  category?: string | null
}

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''

  const products = await prisma.product.findMany({
    where: { userId: user.id as string },
    orderBy: { name: 'asc' },
  })

  // Tally how many units of each product have been transported across all orders,
  // so the UI can surface the most-used products first.
  const orders = await prisma.order.findMany({
    where: { userId: user.id as string },
    select: { items: true },
  })
  const usage: Record<string, number> = {}
  for (const o of orders) {
    const items = (Array.isArray(o.items) ? o.items : []) as Array<{ productId?: string; quantity?: number }>
    for (const it of items) {
      if (it?.productId) usage[it.productId] = (usage[it.productId] || 0) + (Number(it.quantity) || 0)
    }
  }

  const withUsage = products.map((p) => ({ ...p, usageCount: usage[p.id] || 0 }))

  const filtered = q
    ? withUsage.filter((p) =>
        p.name.toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q)
        || (p.packaging || '').toLowerCase().includes(q))
    : withUsage

  return NextResponse.json(filtered)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Bulk import: { bulk: [{...}] }
  if (Array.isArray(body?.bulk)) {
    const rows = (body.bulk as ProductInput[])
      .filter((p) => p.name && p.name.trim() !== '')
      .map((p) => ({
        name: p.name.trim(),
        weight: Number(p.weight) || 0,
        packaging: p.packaging?.toString().trim() || null,
        unitsPerPackage: p.unitsPerPackage != null && p.unitsPerPackage !== ('' as unknown) ? Number(p.unitsPerPackage) : null,
        category: p.category?.toString().trim() || null,
        userId: user.id as string,
      }))
    if (rows.length === 0) return NextResponse.json({ error: 'No hay productos válidos' }, { status: 400 })
    await prisma.product.createMany({ data: rows })
    return NextResponse.json({ created: rows.length }, { status: 201 })
  }

  // Single create
  const { name, weight, packaging, unitsPerPackage, category } = body as ProductInput
  if (!name || name.trim() === '') {
    return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 })
  }
  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      weight: Number(weight) || 0,
      packaging: packaging?.toString().trim() || null,
      unitsPerPackage: unitsPerPackage != null ? Number(unitsPerPackage) : null,
      category: category?.toString().trim() || null,
      userId: user.id as string,
    },
  })
  return NextResponse.json(product, { status: 201 })
}
