import { NextRequest } from 'next/server'
import { AuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  const pedida = user.branchId || req.headers.get('x-sucursal-id')?.trim() || null

  if (!pedida) return { branchId: null, actorId: user.id }

  /**
   * Una sucursal que NO existe no acota: se ignora.
   *
   * El id de sucursal llega por dos sitios y los dos pueden traer uno viejo. El token del
   * login único dura siete días y lleva dentro la sucursal que tenía la persona CUANDO
   * entró; y la cabecera `x-sucursal-id` sale de lo que el navegador guardó. Las
   * sucursales se recrearon en algún momento —unas tienen id de cuid y otras
   * hexadecimal—, así que ambos pueden apuntar a algo que ya no está.
   *
   * Y filtrar por un id inexistente no da error: da CERO. Cero pedidos, cero clientes,
   * cero rutas, cero vehículos, y hasta cero sucursales —con lo que desaparece el
   * selector con el que se podría arreglar—. Todo con 200 y sin una sola traza. Es
   * exactamente lo que se vio en producción, y desde dentro es indistinguible de "no hay
   * nada todavía".
   *
   * Se comprueba antes de usarla. Si no existe se pasa a "todas", que para quien
   * administra es lo correcto y además deja ver el problema en vez de esconderlo.
   */
  const existe = await prisma.branch.findUnique({ where: { id: pedida }, select: { id: true } })

  if (!existe) {
    console.warn(`[alcance] la sucursal ${pedida} no existe: se pasa a todas`)
    return { branchId: null, actorId: user.id }
  }

  return { branchId: pedida, actorId: user.id }
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

/**
 * La sucursal a la que PERTENECE la persona, si existe.
 *
 * Es distinta del alcance: el alcance mezcla el permiso con la sucursal elegida arriba, y
 * hay sitios —la lista de sucursales— donde eso no vale. Ahí lo que se pregunta es «a
 * cuáles puedes llegar», que sólo depende de la persona: si se acotara también por la
 * elegida, elegir una devolvería una sola, el selector se volvería una etiqueta fija y no
 * habría forma de cambiar a otra. La elección se comería la lista con la que se elige.
 *
 * Y se comprueba que exista, por lo mismo que en `resolveScope`: el token dura siete días
 * y lleva la sucursal que la persona tenía al entrar. Una que ya no está no acota nada —
 * deja la lista vacía, que es peor.
 */
export async function sucursalDeLaPersona(user: AuthUser): Promise<string | null> {
  if (!user.branchId) return null

  const existe = await prisma.branch.findUnique({ where: { id: user.branchId }, select: { id: true } })

  if (!existe) {
    console.warn(`[alcance] la sucursal ${user.branchId} de ${user.email} no existe: se le enseñan todas`)
    return null
  }

  return user.branchId
}
