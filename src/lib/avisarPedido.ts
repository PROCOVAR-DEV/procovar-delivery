/**
 * Decirle a PEDIDO qué pasó con la FACTURA.
 *
 * PEDIDO recoge lo que el cliente pide; Ventra factura lo que de verdad se lleva, y las
 * dos cosas no siempre coinciden. Hasta ahora, en PEDIDO no había forma de saberlo: el
 * vendedor veía su pedido tal como lo tomó, aunque en el almacén se hubiera facturado la
 * mitad.
 *
 * Quien puede contarlo es delivery. Ventra es un ERP detrás de una VPN que no avisa a
 * nadie —hay que preguntarle—, y quien ya le pregunta cada minuto, sucursal por sucursal,
 * y cruza factura contra pedido, es esto. Así que el cotejo se hace una vez, aquí, y el
 * resultado se le manda allí.
 *
 * Es «lo mejor que se pueda»: si PEDIDO no contesta, no se rompe nada de este lado. El
 * cotejo ya está guardado y el aviso se reintenta solo en la pasada siguiente, porque lo
 * que marca que un pedido está avisado es haberlo avisado, no haberlo intentado.
 */

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:8400'
const KEY = process.env.SERVICE_API_KEY || ''

export interface AvisoFactura {
  /** El id del pedido EN PEDIDO. Delivery lo guarda en `externalId` de cada copia. */
  pedidoId: string
  estado: 'igual' | 'cambiado' | 'sin_factura'
  numero: string | null
  /** El costo recalculado, si la factura cambió el peso. Sin esto, no se toca el suyo. */
  costo?: number | null
  distanciaKm?: number | null
  distanciaDesde?: string | null
}

export interface ResultadoAviso {
  ok: boolean
  enviados: number
  /** Los que PEDIDO dio por buenos. Sólo esos se dan por avisados de este lado. */
  aplicadosIds: string[]
  rechazados: number
  error?: string
}

/**
 * En tandas de 200.
 *
 * PEDIDO acepta hasta 500 por llamada, pero cada uno puede llevar un recálculo de costo
 * que le hace escribir en el pedido y en el cliente. Una tanda más corta deja la
 * transacción corta y, si algo se cae a mitad, lo que se perdió es una tanda y no el día.
 */
const TANDA = 200

export async function avisarFacturacionAPedido(avisos: AvisoFactura[]): Promise<ResultadoAviso> {
  if (avisos.length === 0) return { ok: true, enviados: 0, aplicadosIds: [], rechazados: 0 }
  if (!KEY) return { ok: false, enviados: 0, aplicadosIds: [], rechazados: 0, error: 'falta SERVICE_API_KEY' }

  const aplicadosIds: string[] = []
  let rechazados = 0
  let error: string | undefined

  for (let i = 0; i < avisos.length; i += TANDA) {
    const tanda = avisos.slice(i, i + TANDA)

    try {
      const res = await fetch(`${PEDIDO_API_URL}/integration/orders/invoicing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ facturas: tanda }),
        cache: 'no-store',
      })

      if (!res.ok) {
        error = `PEDIDO contestó ${res.status}`
        rechazados += tanda.length
        continue
      }

      const cuerpo = (await res.json()) as {
        aplicadas?: Array<{ pedidoId?: string }>
        rechazadas?: Array<{ motivo?: string }>
      }

      for (const a of cuerpo.aplicadas ?? []) if (a?.pedidoId) aplicadosIds.push(a.pedidoId)
      rechazados += cuerpo.rechazadas?.length ?? 0
      // El primer motivo, para que salga en el log de la sincronización: «no existe aquí»
      // repetido cuatrocientas veces es un emparejamiento roto, no un pedido raro.
      if (!error && cuerpo.rechazadas?.length) error = cuerpo.rechazadas[0]?.motivo
    } catch (e) {
      error = (e as Error).message
      rechazados += tanda.length
    }
  }

  return { ok: !error, enviados: avisos.length, aplicadosIds, rechazados, error }
}
