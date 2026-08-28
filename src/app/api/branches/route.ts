import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * Las sucursales NO son de nadie.
 *
 * Esto filtraba por `creatorId: user.id` — «las que creó este usuario»— y era el mismo
 * fallo que el resto de la aplicación tenía ya corregido (ver `lib/scope`): aquí nada
 * pertenece a una persona.
 *
 * Y no era un detalle. Las ocho sucursales las creó `jose@procovar.com`; quien entra por
 * el login único con otra cuenta —`josework2207@gmail.com`, que es OTRA fila de `User`—
 * recibía una lista VACÍA. Con eso desaparece el selector de sucursal de la barra, el
 * asistente de nueva ruta se queda sin nada que elegir y no se puede crear ni una ruta.
 * Ocho sucursales con cincuenta mil pedidos detrás, invisibles porque las dio de alta
 * otra cuenta.
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Quien pertenece a una sucursal ve la suya; quien no —el Super Admin— las ve todas.
  const scope = await resolveScope(req, user)
  const where = scope.branchId ? { id: scope.branchId } : {}
  const branches = await prisma.branch.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { members: true, origins: true } } },
  })

  return NextResponse.json(branches)
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { name, address, lat, lng, areaKm2, externalId } = await req.json()

  if (!name || lat == null || lng == null) {
    return NextResponse.json({ error: 'Nombre y coordenadas son requeridos' }, { status: 400 })
  }

  const branch = await prisma.branch.create({
    data: {
      name,
      address: address || null,
      lat,
      lng,
      areaKm2: areaKm2 ?? 1,
      // Mapea esta sucursal con la de PEDIDO (necesario para /api/quote y el batch).
      externalId: externalId || null,
      // Crear con coords = el usuario fijó el punto de partida (habilita el cálculo).
      originConfigured: true,
      creatorId: user.id as string,
      // Auto-crea el PUNTO DE PARTIDA por defecto desde la ubicación de la sucursal:
      // al guardar una sucursal con coords ya queda su punto de partida listo (antes
      // quedaba en "0"). El usuario puede agregar más puntos después.
      origins: {
        create: [{
          name,
          address: address || `${lat}, ${lng}`,
          lat,
          lng,
          userId: user.id as string,
        }],
      },
    },
    include: { _count: { select: { origins: true } } },
  })

  return NextResponse.json(branch, { status: 201 })
}
