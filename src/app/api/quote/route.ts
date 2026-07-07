import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import { haversineDistance, calculateHomeDeliveryPrice } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

interface QuoteItem {
  description?: string
  name?: string
  weight?: number
  quantity?: number
}

function weightFromItems(items: QuoteItem[] | undefined, fallback: number): number {
  if (!Array.isArray(items) || items.length === 0) return fallback || 0
  const w = items.reduce((a, it) => a + (Number(it.weight) || 0) * (Number(it.quantity) || 1), 0)
  return w > 0 ? w : (fallback || 0)
}

/**
 * POST /api/quote — Cotiza (y por defecto guarda) el envío a domicilio de UN pedido
 * que llega desde la app PEDIDO. Auth: header `x-api-key`.
 *
 * Devuelve el precio + desglose para que PEDIDO lo muestre y lo registre en su
 * sistema contable.
 */
export async function POST(req: NextRequest) {
  if (!isValidServiceKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
  }

  const {
    sucursalExternalId,
    customerName,
    address,
    lat,
    lng,
    weight,
    items,
    operationNumber,
    externalId,
    notes,
    preview = false,
  }: {
    sucursalExternalId?: string
    customerName?: string
    address?: string
    lat?: number
    lng?: number
    weight?: number
    items?: QuoteItem[]
    operationNumber?: string
    externalId?: string
    notes?: string
    preview?: boolean
  } = body

  if (!sucursalExternalId) {
    return NextResponse.json({ error: 'sucursalExternalId es requerido' }, { status: 400 })
  }
  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'Las coordenadas del cliente (lat, lng) son requeridas' }, { status: 400 })
  }

  // Resolver la sucursal de origen (delivery es el dueño de las coordenadas).
  const branch = await prisma.branch.findUnique({ where: { externalId: sucursalExternalId } })
  if (!branch) {
    return NextResponse.json(
      { error: `Sucursal '${sucursalExternalId}' no está mapeada en delivery (Branch.externalId)` },
      { status: 404 }
    )
  }

  // Cargar config de pricing (crea defaults si no existe).
  let settings = await prisma.settings.findFirst()
  if (!settings) settings = await prisma.settings.create({ data: {} })

  const weightKg = weightFromItems(items, Number(weight) || 0)
  const distanceKm = haversineDistance(branch.lat, branch.lng, lat, lng)

  const quote = calculateHomeDeliveryPrice(distanceKm, weightKg, {
    domBaseFee: settings.domBaseFee,
    domCostPerKm: settings.domCostPerKm,
    domCostPerKg: settings.domCostPerKg,
    domIncludedKm: settings.domIncludedKm,
    domMinFee: settings.domMinFee,
    domRoundTo: settings.domRoundTo,
  })

  let orderId: string | null = null

  if (!preview) {
    if (!customerName) {
      return NextResponse.json({ error: 'customerName es requerido para guardar el pedido' }, { status: 400 })
    }

    const data = {
      operationNumber: operationNumber || null,
      customerName,
      address: address || customerName,
      endAddress: address || null,
      endLat: lat,
      endLng: lng,
      lat,
      lng,
      weight: weightKg || 1,
      items: (Array.isArray(items) ? items : []) as unknown as Prisma.InputJsonValue,
      notes: notes || null,
      deliveryPrice: quote.price,
      deliveryDistanceKm: distanceKm,
      branchId: branch.id,
      source: 'pedido',
      externalId: externalId || operationNumber || null,
      // El pedido queda bajo el dueño de la sucursal para que aparezca en su panel
      // y pueda añadirse luego a una ruta.
      userId: branch.creatorId,
    }

    // Idempotencia: si ya existe un pedido de PEDIDO con ese externalId, se actualiza.
    const existing = data.externalId
      ? await prisma.order.findFirst({ where: { source: 'pedido', externalId: data.externalId } })
      : null

    const order = existing
      ? await prisma.order.update({ where: { id: existing.id }, data })
      : await prisma.order.create({ data })

    orderId = order.id
  }

  return NextResponse.json({
    orderId,
    price: quote.price,
    currency: settings.currency,
    distanceKm: quote.distanceKm,
    chargeableKm: quote.chargeableKm,
    weightKg: quote.weightKg,
    breakdown: quote.breakdown,
    branch: { id: branch.id, name: branch.name },
  })
}
