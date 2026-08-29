/**
 * La ruta, fuera de esta pantalla: en Google Maps y en minutos.
 *
 * Quien reparte no entra aquí: lleva un teléfono y la navegación que ya sabe usar. Y
 * quien despacha pregunta al día siguiente cuánto se demoró. Las dos cosas salen de datos
 * que ya están —las paradas en su orden, y las horas de salida y regreso—, así que es
 * cuestión de darles forma, no de pedirle nada a nadie.
 */

export interface ParadaRuta {
  endLat?: number | null
  endLng?: number | null
  stopOrder?: number | null
}

export interface RutaCompartible {
  originLat?: number | null
  originLng?: number | null
  orders?: ParadaRuta[]
  startedAt?: string | null
  finishedAt?: string | null
}

/** Google Maps admite hasta esto en una sola dirección. */
const TOPE_PARADAS = 25

/**
 * El enlace de navegación con todas las paradas, en orden.
 *
 * `dir_action=navigate` la abre lista para arrancar en el móvil. El destino es el ALMACÉN:
 * el camión vuelve, y una ruta que termina en el último cliente deja al chofer buscándose
 * la vuelta.
 *
 * Google no acepta más de 25 puntos; si la ruta es más larga se recorta y quien llama lo
 * dice — un enlace que se come cinco paradas en silencio es peor que no tenerlo.
 */
export function enlaceGoogleMaps(ruta: RutaCompartible | null | undefined): string | null {
  if (!ruta?.originLat || !ruta?.originLng) return null

  const paradas = (ruta.orders ?? [])
    .filter((o) => o.endLat != null && o.endLng != null)
    .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
    .map((o) => `${o.endLat},${o.endLng}`)

  if (!paradas.length) return null

  const origen = `${ruta.originLat},${ruta.originLng}`
  const intermedias = paradas.slice(0, TOPE_PARADAS)
  const url = new URL('https://www.google.com/maps/dir/')

  url.searchParams.set('api', '1')
  url.searchParams.set('travelmode', 'driving')
  url.searchParams.set('dir_action', 'navigate')
  url.searchParams.set('origin', origen)
  url.searchParams.set('destination', origen)
  url.searchParams.set('waypoints', intermedias.join('|'))

  return url.toString()
}

/** Cuántas paradas se quedaron fuera del enlace, si alguna. */
export function paradasFueraDelEnlace(ruta: RutaCompartible | null | undefined): number {
  const n = (ruta?.orders ?? []).filter((o) => o.endLat != null && o.endLng != null).length

  return Math.max(0, n - TOPE_PARADAS)
}

/** «3 h 20 min», o `null` si todavía no ha vuelto (o no se marcó la salida). */
export function duracionDeRuta(ruta: RutaCompartible | null | undefined): string | null {
  if (!ruta?.startedAt || !ruta?.finishedAt) return null

  const ms = new Date(ruta.finishedAt).getTime() - new Date(ruta.startedAt).getTime()

  if (!Number.isFinite(ms) || ms <= 0) return null

  const minutos = Math.round(ms / 60000)
  const horas = Math.floor(minutos / 60)

  return horas > 0 ? `${horas} h ${minutos % 60} min` : `${minutos} min`
}

/** «Salió 8:05 · volvió 11:25», para el título del ratón. */
export function horasDeRuta(ruta: RutaCompartible | null | undefined): string | undefined {
  if (!ruta?.startedAt) return undefined

  const hora = (d: string) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  return ruta.finishedAt
    ? `Salió ${hora(ruta.startedAt)} · volvió ${hora(ruta.finishedAt)}`
    : `Salió ${hora(ruta.startedAt)}, todavía en la calle`
}
