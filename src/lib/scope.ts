import { NextRequest } from 'next/server'
import { AuthUser } from '@/lib/auth'

export interface Scope {
  /**
   * Sucursal a la que se limita la consulta. `null` = todas.
   *
   * Es lo ÚNICO que decide qué se ve. Aquí nada pertenece a una persona: los
   * pedidos entran solos desde PEDIDO y son de la sucursal que los originó.
   */
  branchId: string | null
  /**
   * Quién está haciendo la petición. Se usa para dejar constancia de quién creó
   * algo —y nada más—. **No filtra.** Ver abajo por qué.
   */
  actorId: string
}

/**
 * A qué datos llega quien pide.
 *
 * - Quien pertenece a una sucursal: solo la suya, siempre.
 * - Quien no pertenece a ninguna (el Super Admin): todas, o la que elija en el
 *   selector (`x-sucursal-id`).
 */
export async function resolveScope(req: NextRequest, user: AuthUser): Promise<Scope> {
  if (user.branchId) return { branchId: user.branchId, actorId: user.id }

  const elegida = req.headers.get('x-sucursal-id')?.trim()
  return { branchId: elegida && elegida.length ? elegida : null, actorId: user.id }
}

/**
 * El filtro de Prisma. **Por sucursal, nunca por cuenta.**
 *
 * # Qué había antes y por qué estaba mal
 *
 * Filtraba por `userId`, usando como "dueño" al creador de la sucursal. Como las
 * ocho sucursales las creó el Super Admin, los 3.528 pedidos que entraron desde
 * PEDIDO quedaron todos a su nombre — no porque sean suyos, sino porque la
 * sincronización tenía que poner a alguien y ponía al creador.
 *
 * Eso no era solo feo: escondía datos. Un pedido creado por una operadora de
 * Holguín llevaba SU identificador, así que no casaba con el del creador y sus
 * propios compañeros de Holguín no lo veían. El mismo fallo, al revés, con dos
 * administradores: cada uno veía solo lo suyo.
 *
 * Aquí nada es de nadie. Los pedidos llegan solos desde PEDIDO y pertenecen a la
 * sucursal que los originó, que es lo que `Order.branchId` ya guardaba bien
 * desde el principio.
 *
 * `userId` se sigue escribiendo al crear algo a mano, y sirve para saber quién
 * lo hizo. Para eso, y para nada más.
 */
export function scopeWhere(scope: Scope): { branchId?: string } {
  return scope.branchId ? { branchId: scope.branchId } : {}
}
