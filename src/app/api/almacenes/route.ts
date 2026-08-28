import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, sucursalDeLaPersona } from '@/lib/scope'
import { prisma } from '@/lib/prisma'
import { enviarFirmado, pedirFirmado } from '@/lib/procovar-auth'

export const dynamic = 'force-dynamic'

/**
 * Los ALMACENES de cada sucursal, gestionados AQUÍ.
 *
 * El dato vive en Accesos —el almacén es de la sucursal, y la sucursal es suya— pero
 * quien lo usa y quien sabe si es correcto es delivery: el domicilio se cobra por la
 * distancia DESDE el almacén, así que un punto mal puesto se cobra mal en cada entrega, y
 * quien lo nota es el que reparte. Se edita donde se nota.
 *
 * Esto no guarda ninguna copia: pregunta y escribe en Accesos, firmado. Guardar una copia
 * sería tener el mismo dato en dos sitios, que es lo que esto viene a quitar.
 */

interface Almacen {
  id?: string
  nombre: string
  direccion?: string | null
  latitud?: number | null
  longitud?: number | null
  principal?: boolean
  activo?: boolean
}

interface SucursalConAlmacenes {
  codigo: string
  nombre: string
  almacenes: Almacen[]
}

/** Los códigos de sucursal que esta persona puede ver. */
async function codigosVisibles(req: NextRequest, user: NonNullable<ReturnType<typeof getUserFromRequest>>) {
  const suya = await sucursalDeLaPersona(user)
  const scope = await resolveScope(req, user)
  // El de la barra acota además del permiso, nunca en su lugar.
  const id = suya ?? scope.branchId

  const branches = await prisma.branch.findMany({
    where: { externalId: { not: null }, ...(id ? { id } : {}) },
    select: { externalId: true },
  })

  return new Set(branches.map((b) => b.externalId as string))
}

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const visibles = await codigosVisibles(req, user)
    const { sucursales } = await pedirFirmado<{ sucursales: SucursalConAlmacenes[] }>('/api/service/almacenes')

    return NextResponse.json({
      // Se filtra por lo que esta persona puede ver: Accesos las devuelve todas porque
      // no sabe de sucursales de delivery, y el alcance es cosa nuestra.
      sucursales: sucursales.filter((s) => visibles.has(s.codigo)),
    })
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron traer los almacenes de Accesos: ${(e as Error).message}` },
      { status: 502 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { codigo?: string; almacenes?: Almacen[] } | null

  if (!body?.codigo || !Array.isArray(body.almacenes)) {
    return NextResponse.json({ error: 'Se espera { codigo, almacenes: [...] }' }, { status: 400 })
  }

  // Quien sólo ve una sucursal no puede tocar los almacenes de otra pasando el código a
  // mano: se comprueba contra lo que de verdad puede ver.
  const visibles = await codigosVisibles(req, user)

  if (!visibles.has(body.codigo)) {
    return NextResponse.json({ error: 'Sin acceso a esa sucursal' }, { status: 403 })
  }

  /**
   * Un almacén sin coordenadas no sirve para lo que existe.
   *
   * Se puede guardar —a veces se da de alta antes de tener el punto— pero se avisa: sin
   * lat/lng no se puede medir la distancia, y los pedidos de esa sucursal se quedan sin
   * cotizar sin que nada lo diga.
   */
  const sinPunto = body.almacenes.filter((a) => a.latitud == null || a.longitud == null)

  try {
    const r = await enviarFirmado<{ almacenes: Almacen[] }>('/api/service/almacenes', 'PUT', body)

    return NextResponse.json({
      ...r,
      aviso: sinPunto.length
        ? `${sinPunto.length} almacén(es) sin coordenadas: desde ésos no se puede medir el domicilio.`
        : null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Accesos no aceptó el cambio: ${(e as Error).message}` },
      { status: 502 },
    )
  }
}
