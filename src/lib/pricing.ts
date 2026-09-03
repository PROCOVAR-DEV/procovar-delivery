/**
 * Aquí vivían CUATRO fórmulas de precio y sólo una se usaba.
 *
 * `calculateOrderPrice` (base + km + kg), `calculateShareDeliveryPrice` (la fracción de
 * peso de la carga) y `computeRoutePricing` (el reparto por tramos) no las llamaba nadie:
 * eran restos de tres intentos distintos de cobrar el reparto. Estaban a un `import` de
 * volver a usarse, y quien abría el fichero no podía saber cuál era la buena.
 *
 * Y `calculateDomicilioOficial` (C = CKK x D x PP) sí se usaba, pero era la SEGUNDA: el
 * mismo pedido costaba una cosa entrando por el espejo y otra entrando a mano, porque el
 * otro camino usaba la fórmula de Entrega. Se fue también.
 *
 * **El precio del domicilio lo pone la APK de Entrega y nadie más.** Aquí no se calcula:
 * se muestra. Lo único que queda de esto es la geometría —distancias y orden de visita—,
 * que sí es de delivery porque es lo que arma el recorrido del camión.
 */

export interface HomeDeliveryQuote {
  distanceKm: number
  chargeableKm: number
  weightKg: number
  /**
   * `null` = no se pudo estimar aquí. No es cero.
   *
   * Un cero es un precio: se suma, se ordena y se lee como «este domicilio es gratis».
   * Pasa cuando la sucursal no tiene vehículo de referencia o no tiene tasa, y el pedido
   * se guarda igual — el precio que se cobra es el de PEDIDO (`pedidoCosto`), no éste.
   */
  price: number | null
  breakdown: {
    base: number
    distance: number
    weight: number
    beforeMin: number | null
    beforeRound: number | null
  }
}

export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function greedyRouteOptimization(
  origin: { lat: number; lng: number },
  stops: Array<{ id: string; lat: number; lng: number }>
): string[] {
  if (stops.length === 0) return []
  if (stops.length === 1) return [stops[0].id]

  const unvisited = [...stops]
  const route: string[] = []

  let current: { lat: number; lng: number } = origin

  while (unvisited.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistance(
        current.lat, current.lng,
        unvisited[i].lat, unvisited[i].lng
      )
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    current = unvisited.splice(nearestIdx, 1)[0]
    route.push((current as { id: string; lat: number; lng: number }).id)
  }

  return route
}

/**
 * Returns the actual driving distances between consecutive stops (origin → stop1 → stop2 → ...).
 * Used only for route totalDistance (km reales del camión).
 */
export function calculateRouteSegments(
  origin: { lat: number; lng: number },
  orderedStops: Array<{ lat: number; lng: number }>
): number[] {
  const segments: number[] = []
  let prev = origin
  for (const stop of orderedStops) {
    segments.push(haversineDistance(prev.lat, prev.lng, stop.lat, stop.lng))
    prev = stop
  }
  return segments
}
