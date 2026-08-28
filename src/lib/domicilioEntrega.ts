/**
 * El costo del domicilio, con la MISMA fórmula que usa Entrega.
 *
 * Un pedido metido a mano en delivery tiene que salir por el mismo número que uno hecho
 * desde el teléfono. Si aquí se inventa una fórmula parecida, el mismo reparto vale una
 * cosa en un sitio y otra en el otro, y nadie sabe cuál cobrar.
 *
 * La de Entrega (`services/calculo.ts` en la APK y `SyncService` en su backend) es:
 *
 *     tarifa base (USD por km·kg) × distancia (km) × peso (kg)
 *
 * con la distancia en línea recta (Haversine) del almacén al cliente, y redondeando a dos
 * decimales. La tarifa se guarda allí en CUP, así que se pasa a USD dividiendo por la tasa
 * de ESA sucursal — exactamente lo que hace la APK antes de multiplicar.
 *
 * Nada de esto se configura aquí: la tarifa y la tasa vienen de Entrega a través de
 * Accesos. Tener una copia editable en delivery es volver a tener dos números para lo
 * mismo, que es de donde se viene.
 */

const RADIO_TIERRA_KM = 6371

const aRadianes = (g: number) => (g * Math.PI) / 180

/** Distancia en línea recta, igual que la APK. */
export function distanciaHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = aRadianes(lat2 - lat1)
  const dLon = aRadianes(lon2 - lon1)
  const a
    = Math.sin(dLat / 2) ** 2
    + Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) * Math.sin(dLon / 2) ** 2

  return RADIO_TIERRA_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales

  return Math.round((valor + Number.EPSILON) * factor) / factor
}

export interface CostoDomicilio {
  distanciaKm: number
  pesoKg: number
  /** En USD, que es como se guarda todo aquí. */
  usd: number
  cup: number
  /** La tarifa que se usó, ya en USD por km·kg. */
  tarifaUsd: number
}

/**
 * @param tarifaBaseCup  CUP por km·kg, de Entrega.
 * @param cupPorUsd      la tasa de ESA sucursal. Sin ella no se puede pasar a USD.
 *
 * Devuelve `null` cuando falta cualquiera de las dos o no hay distancia: un cero se suma
 * y se lee como «este domicilio es gratis», que es peor que decir que no se sabe.
 */
export function costoDomicilioEntrega(
  tarifaBaseCup: number | null | undefined,
  cupPorUsd: number | null | undefined,
  distanciaKm: number,
  pesoKg: number,
): CostoDomicilio | null {
  if (!tarifaBaseCup || !cupPorUsd || cupPorUsd <= 0) return null
  if (!Number.isFinite(distanciaKm) || !Number.isFinite(pesoKg)) return null

  const tarifaUsd = tarifaBaseCup / cupPorUsd
  const usd = redondear(tarifaUsd * distanciaKm * pesoKg)

  return { distanciaKm: redondear(distanciaKm, 3), pesoKg: redondear(pesoKg, 3), usd, cup: redondear(usd * cupPorUsd), tarifaUsd }
}
