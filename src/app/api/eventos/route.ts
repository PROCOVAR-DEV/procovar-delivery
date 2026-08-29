import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { CANAL_CAMBIOS, getSubscriber, redisEnabled } from '@/lib/redis'

export const dynamic = 'force-dynamic'
// Un flujo abierto no puede correr en el borde ni cachearse.
export const runtime = 'nodejs'

/**
 * GET /api/eventos — lo que va cambiando, en vivo.
 *
 * # Por qué existe
 *
 * Nada de lo que se ve aquí lo cambia esta pantalla: el espejo trae pedidos, el repartidor
 * pone el costo desde Entrega, Ventra factura. Sin aviso, la pantalla se entera al
 * refrescar —o cuando alguien recarga—, y hasta entonces enseña algo que ya no es verdad:
 * un pedido «sin cotizar» que se cotizó hace diez minutos.
 *
 * # Cómo
 *
 * Server-Sent Events: una conexión que el servidor deja abierta y por la que va mandando
 * líneas. No hace falta WebSocket —esto es de una sola dirección— y atraviesa cualquier
 * proxy como una petición normal.
 *
 * Detrás va Redis: quien cambia algo publica en `CANAL_CAMBIOS` y todas las instancias
 * avisan a sus pantallas. Sin Redis esto sigue funcionando y no avisa de nada; las
 * pantallas siguen refrescando cada treinta segundos por su cuenta, que es como estaban.
 */
export async function GET(req: NextRequest) {
  if (!getUserFromRequest(req)) return new Response('Unauthorized', { status: 401 })

  const sub = getSubscriber()

  if (!redisEnabled() || !sub) {
    // Se dice que no hay avisos en vivo, en vez de dejar una conexión abierta que no va a
    // traer nada nunca: la pantalla sabe entonces que le toca refrescar sola.
    return new Response('event: sin-vivo\ndata: {}\n\n', {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
    })
  }

  const canal = sub.duplicate()
  const codificador = new TextEncoder()

  const flujo = new ReadableStream({
    async start(controlador) {
      const mandar = (evento: string, datos: unknown) => {
        controlador.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`))
      }

      mandar('listo', { vivo: true })

      await canal.subscribe(CANAL_CAMBIOS)
      canal.on('message', (_c: string, mensaje: string) => {
        try {
          mandar('cambio', JSON.parse(mensaje))
        } catch {
          mandar('cambio', { tipo: 'desconocido' })
        }
      })

      /**
       * Un latido cada veinte segundos.
       *
       * Los proxys cierran las conexiones calladas al minuto o dos. Sin esto, la pantalla
       * se queda con una conexión muerta que parece viva y deja de enterarse de todo.
       */
      const latido = setInterval(() => {
        try {
          controlador.enqueue(codificador.encode(': latido\n\n'))
        } catch {
          clearInterval(latido)
        }
      }, 20000)

      req.signal.addEventListener('abort', () => {
        clearInterval(latido)
        void canal.quit()
        try {
          controlador.close()
        } catch { /* ya estaba cerrado */ }
      })
    },
  })

  return new Response(flujo, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Nginx y Traefik guardan lo que pasa por ellos: sin esto, los avisos llegan a
      // ráfagas de un minuto y el «tiempo real» no lo es.
      'x-accel-buffering': 'no',
    },
  })
}
