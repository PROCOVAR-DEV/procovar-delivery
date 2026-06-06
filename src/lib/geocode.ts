/**
 * Geocoding helpers shared across the app.
 * Uses Nominatim (OpenStreetMap) — no API key required.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const UA = 'ProCovarDelivery/1.0'

export interface LatLng {
  lat: number
  lng: number
}

/** Forward geocode: free-text address -> coordinates. Returns null if not found. */
export async function forwardGeocode(query: string): Promise<LatLng | null> {
  if (query.trim().length < 4) return null
  try {
    const res = await fetch(
      `${NOMINATIM}/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=es`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } }
    )
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    return null
  } catch {
    return null
  }
}

/** Reverse geocode: coordinates -> human-readable address. Falls back to formatted coords. */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=es`,
      { headers: { 'User-Agent': UA } }
    )
    const data = (await res.json()) as { display_name?: string }
    return data.display_name || formatCoords(lat, lng)
  } catch {
    return formatCoords(lat, lng)
  }
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

/**
 * Detect and parse a "lat, lng" coordinate string typed directly into a text field.
 * Accepts e.g. "-23.5505, -46.6333" or "23.55 -46.63". Returns null if not a coord pair.
 */
export function parseCoordInput(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}
