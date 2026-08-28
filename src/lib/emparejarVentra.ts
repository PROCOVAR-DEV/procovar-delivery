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

  /**
   * Las formas en que puede venir escrito NUESTRO nombre.
   *
   * Los nombres de aquí llevan cosas que Ventra no usa: «Bayamo (Granma)» lleva las dos
   * en una, y «Santiago de Cuba» lleva el «de Cuba» que allí no está. Los dos se quedaron
   * sin catálogo en la primera pasada y sólo se vio porque el sondeo lo dice.
   */
  const formas = (s: SucursalLocal): string[] => {
    const n = s.name
    const sinParentesis = n.replace(/\([^)]*\)/g, ' ')
    const dentro = [...n.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])

    return [n, sinParentesis, ...dentro, s.externalId ?? ''].map(normalizarNombre).filter(Boolean)
  }

  return sucursales.map((s) => {
    const posibles = formas(s)
    const exacta = posibles.map((f) => porClave.get(f)).find(Boolean)

    if (exacta) return { ...s, database: exacta }

    /**
     * Último recurso: que una clave de Ventra esté CONTENIDA en nuestro nombre, y que
     * todas las que encajen lleven a la MISMA base.
     *
     * Así «Santiago de Cuba» encuentra `santiago`. Si encajaran dos bases distintas se
     * devuelve null a propósito: darle a una sucursal el catálogo de otra sale con
     * precios y existencias creíbles que nadie cuestiona, y eso no se arregla después.
     */
    const candidatas = new Set<string>()

    for (const [clave, base] of porClave) {
      if (clave.length < 4) continue
      if (posibles.some((f) => f.includes(clave) || clave.includes(f))) candidatas.add(base)
    }

    return { ...s, database: candidatas.size === 1 ? [...candidatas][0] : null }
  })
}
