/**
 * Nuestra sucursal ↔ la base de Ventra.
 *
 * Vive aparte de la ruta que lo usa por dos razones: Next no deja exportar de un
 * `route.ts` nada que no sea un manejador, y esto es justo lo que hay que poder probar
 * solo — cuando falla no salta nada, simplemente una sucursal se queda sin catálogo.
 *
 * Se cruza por el nombre normalizado contra las DOS cosas que da Ventra: el slug de la
 * base y su propio nombre de sucursal. Hay que preguntárselo, no deducirlo: sus slugs no
 * se parecen a lo que uno supondría —`granma` es BAYAMO, `sspiritus` es Sancti Spíritus,
 * `tunas` es Las Tunas— y adivinar falla en cuatro de diez.
 */

/** Sin acentos, sin signos y en minúsculas: para poder comparar nombres. */
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface SucursalLocal {
  id: string
  name: string
  externalId: string | null
}

export function emparejarConVentra(
  sucursales: SucursalLocal[],
  bases: { database: string; branchName: string }[],
) {
  const porClave = new Map<string, string>()

  for (const b of bases) {
    porClave.set(normalizarNombre(b.database), b.database)
    if (b.branchName) porClave.set(normalizarNombre(b.branchName), b.database)
  }

  return sucursales.map((s) => ({
    ...s,
    database:
      porClave.get(normalizarNombre(s.name))
      ?? porClave.get(normalizarNombre(s.externalId ?? ''))
      ?? null,
  }))
}
