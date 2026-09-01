/**
 * Avisar de que algo cambió, para que las pantallas se pongan al día solas.
 *
 * Se publica en Redis y lo reparte `/api/eventos` a cada navegador abierto. El aviso lleva
 * QUÉ cambió —pedidos, facturación, catálogo, rutas— porque invalidarlo todo en cada
 * cambio significa volver a pedir el catálogo entero cada vez que alguien cotiza un
 * domicilio.
 *
 * Nunca revienta ni bloquea: es un aviso, no el trabajo. Si Redis no está, no se avisa y
 * las pantallas siguen refrescando por su cuenta cada treinta segundos.
 */

import { CANAL_CAMBIOS, publishJSON, redisEnabled } from '@/lib/redis'

export type TipoCambio = 'pedidos' | 'catalogo' | 'rutas' | 'clientes'

/**
 * Cuándo se avisó por última vez de cada cosa.
 *
 * El espejo importa por lotes de doscientos y avisaba por cada uno: veinte avisos
 * seguidos, y la pantalla recargándose veinte veces. Se avisa como mucho una vez cada
 * quince segundos por tipo — lo que pasa en ese rato viaja en el siguiente aviso.
 */
const ULTIMO = new Map<string, number>()
const FRENO_MS = 15000

export async function avisarCambio(tipo: TipoCambio, detalle?: Record<string, unknown>): Promise<void> {
  if (!redisEnabled()) return

  const ahora = Date.now()

  if (ahora - (ULTIMO.get(tipo) ?? 0) < FRENO_MS) return
  ULTIMO.set(tipo, ahora)

  try {
    await publishJSON(CANAL_CAMBIOS, { tipo, ...detalle, cuando: new Date().toISOString() })
  } catch {
    // Un aviso perdido no puede tumbar una importación de mil pedidos.
  }
}
