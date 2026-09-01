/**
 * Contarle a PEDIDO en qué punto del reparto va cada pedido.
 *
 * En PEDIDO el vendedor ve su pedido y nada más: no sabe si salió, si llegó o si volvió
 * al almacén. Lo sabe delivery, porque es donde pasan esas cosas —se arma la ruta, sale
 * el camión, se marca cada parada—, así que se cuentan desde aquí.
 *
 *   despachado   — la ruta se creó con ese pedido dentro: ya está cargado.
 *   en_transito  — la ruta arrancó.
 *   entregado    — se le dio al cliente.
 *   devuelto     — volvió al almacén: el cliente no lo quiso.
 *   cancelado    — se canceló antes de salir o durante el reparto.
 *
 * A la APK de Entrega no se le puede avisar de nada —trabaja sin conexión—, así que el
 * sitio donde esto tiene que quedar escrito es PEDIDO, que es el que siempre está en pie
 * y del que la APK sincroniza cuando puede.
 *
 * Es «lo mejor que se pueda»: si PEDIDO no contesta, aquí no se rompe nada. La ruta sigue
 * su curso y lo que no se pudo contar se cuenta la próxima vez que ese pedido se mueva.
 */

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:8400'
const KEY = process.env.SERVICE_API_KEY || ''

export type EstadoEntrega = 'despachado' | 'en_transito' | 'entregado' | 'devuelto' | 'cancelado'

export interface AvisoEstado {
  /** El id del pedido EN PEDIDO. Delivery lo guarda en `externalId` de cada copia. */
  pedidoId: string
  estado: EstadoEntrega
  nota?: string | null
  at?: string | Date | null
}

export interface ResultadoAviso {
  ok: boolean
  enviados: number
  aplicados: number
  error?: string
}

/**
 * En tandas de 200: PEDIDO acepta hasta 500, pero cada una escribe y publica un aviso en
 * vivo por pedido. Con tandas cortas, lo que se pierde si algo se cae es una tanda.
 */
const TANDA = 200

export async function avisarEstadoAPedido(avisos: AvisoEstado[]): Promise<ResultadoAviso> {
  if (avisos.length === 0) return { ok: true, enviados: 0, aplicados: 0 }
  if (!KEY) return { ok: false, enviados: 0, aplicados: 0, error: 'falta SERVICE_API_KEY' }

  let aplicados = 0
  let error: string | undefined

  for (let i = 0; i < avisos.length; i += TANDA) {
    const tanda = avisos.slice(i, i + TANDA)

    try {
      const res = await fetch(`${PEDIDO_API_URL}/integration/orders/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ pedidos: tanda }),
        cache: 'no-store',
      })

      if (!res.ok) {
        error = `PEDIDO contestó ${res.status}`
        continue
      }

      const cuerpo = (await res.json()) as {
        aplicados?: unknown[]
        rechazados?: Array<{ motivo?: string }>
      }

      aplicados += cuerpo.aplicados?.length ?? 0
      if (!error && cuerpo.rechazados?.length) error = cuerpo.rechazados[0]?.motivo
    } catch (e) {
      error = (e as Error).message
    }
  }

  return { ok: !error, enviados: avisos.length, aplicados, error }
}

/**
 * Lo mismo, pero sin hacer esperar a quien lo llama.
 *
 * Lo usa el arranque de una ruta y el cierre: quien pulsa el botón no tiene por qué
 * quedarse mirando a que PEDIDO conteste, y si PEDIDO está caído la ruta arranca igual.
 */
export function avisarEstadoDeFondo(avisos: AvisoEstado[]): void {
  if (avisos.length === 0) return

  void avisarEstadoAPedido(avisos).then((r) => {
    if (!r.ok) console.warn('[estado] PEDIDO no tomó los estados:', r.error)
  })
}
