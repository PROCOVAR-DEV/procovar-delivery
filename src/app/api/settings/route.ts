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
    currency, cupRate, currencies, tiposVehiculo,
  } = await req.json()

  let settings = await prisma.settings.findFirst()

  /**
   * Aquí ya no se configura ningún precio.
   *
   * Quedan la moneda en la que se muestran los importes y los tipos de vehículo, que son
   * el costo de la FLOTA. Lo que se le cobra al cliente por un domicilio lo pone la APK de
   * Entrega, y esta pantalla llegó a tener doce campos que no leía nadie.
   */
  const updateData = {
    ...(currency !== undefined && { currency }),
    ...(cupRate !== undefined && { cupRate, cupRateUpdatedAt: new Date() }),
    ...(currencies !== undefined && { currencies }),
    ...(tiposVehiculo !== undefined && { tiposVehiculo }),
  }

  settings = settings
    ? await prisma.settings.update({ where: { id: settings.id }, data: updateData })
    : await prisma.settings.create({ data: updateData })

  return NextResponse.json(settings)
}
