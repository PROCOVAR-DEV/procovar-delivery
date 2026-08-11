import { NextRequest } from 'next/server'

/**
 * La dirección pública de esta aplicación, vista desde fuera.
 *
 * `new URL(req.url).origin` **no vale** detrás de un proxy: dentro del
 * contenedor la petición llega a `0.0.0.0:3000`, así que la vuelta del login se
 * construía como `https://0.0.0.0:3000/...` y no llevaba a ninguna parte.
 *
 * Traefik pone la dirección real en `x-forwarded-host` y `x-forwarded-proto`.
 * Se usan esas, y solo si no vienen se cae a la dirección de la petición — que
 * es lo correcto en local, donde no hay proxy delante.
 */
export function origenPublico(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const protocolo = req.headers.get('x-forwarded-proto') ?? 'https'
  if (host) return `${protocolo}://${host}`
  return new URL(req.url).origin
}
