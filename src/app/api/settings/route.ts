import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let settings = await prisma.settings.findFirst()
  if (!settings) {
    settings = await prisma.settings.create({ data: {} })
  }

  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    baseFee, costPerKm, costPerKg, currency, cupRate, currencies,
    domBaseFee, domCostPerKm, domCostPerKg, domIncludedKm, domMinFee, domRoundTo,
  } = await req.json()

  let settings = await prisma.settings.findFirst()

  const updateData = {
    ...(baseFee !== undefined && { baseFee }),
    ...(costPerKm !== undefined && { costPerKm }),
    ...(costPerKg !== undefined && { costPerKg }),
    ...(currency !== undefined && { currency }),
    ...(cupRate !== undefined && { cupRate, cupRateUpdatedAt: new Date() }),
    ...(currencies !== undefined && { currencies }),
    ...(domBaseFee !== undefined && { domBaseFee }),
    ...(domCostPerKm !== undefined && { domCostPerKm }),
    ...(domCostPerKg !== undefined && { domCostPerKg }),
    ...(domIncludedKm !== undefined && { domIncludedKm }),
    ...(domMinFee !== undefined && { domMinFee }),
    ...(domRoundTo !== undefined && { domRoundTo }),
  }

  if (settings) {
    settings = await prisma.settings.update({
      where: { id: settings.id },
      data: updateData,
    })
  } else {
    settings = await prisma.settings.create({
      data: { baseFee, costPerKm, costPerKg, currency, cupRate },
    })
  }

  return NextResponse.json(settings)
}
