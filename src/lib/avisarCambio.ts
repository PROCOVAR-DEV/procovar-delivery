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

export type TipoCambio = 'pedidos' | 'facturacion' | 'catalogo' | 'rutas' | 'clientes'

export async function avisarCambio(tipo: TipoCambio, detalle?: Record<string, unknown>): Promise<void> {
  if (!redisEnabled()) return

  try {
    await publishJSON(CANAL_CAMBIOS, { tipo, ...detalle, cuando: new Date().toISOString() })
  } catch {
    // Un aviso perdido no puede tumbar una importación de mil pedidos.
  }
}
