import { AuthUser } from '@/lib/auth'

/**
 * ¿Manda en toda la empresa, y no solo en una sucursal?
 *
 * En delivery solo hay dos roles, `admin` y `operator`, y bajo `admin` caen
 * tanto el Super Admin como los Administradores de sucursal. Se distinguen por
 * el alcance: **el Super Admin es el único que no pertenece a ninguna
 * sucursal**, porque las ve todas.
 *
 * Se usa para lo que afecta a la empresa entera y no a una sucursal — el
 * catálogo de productos, por ejemplo, que viene del almacén de datos y es el
 * mismo para todos.
 */
export function esSuperAdmin(user: AuthUser | null): boolean {
  return !!user && user.role === 'admin' && !user.branchId
}
