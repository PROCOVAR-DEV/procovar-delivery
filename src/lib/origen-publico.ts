import { NextRequest } from 'next/server'

/**
 * La dirección pública de esta aplicación, vista desde fuera.
 *
 * `new URL(req.url).origin` **no vale** detrás de un proxy: dentro del
 * contenedor la petición llega a `0.0.0.0:3000`, así que la vuelta del login se
 * construía como `https://0.0.0.0:3000/...` y no llevaba a ninguna parte.
 *
 * Manda `PROCOVAR_PUBLIC_URL` si está puesta. Es lo preferible porque las
 * cabeceras `x-forwarded-*` las escribe el proxy, y si algún día el contenedor
 * quedara alcanzable por otro camino, alguien podría mandarlas a mano y
 * conseguir que construyéramos direcciones apuntando a su servidor.
 */
export function origenPublico(req: NextRequest): string {
  const declarado = process.env.PROCOVAR_PUBLIC_URL
  if (declarado) return declarado.replace(/\/+$/, '')

  // Sin `PROCOVAR_PUBLIC_URL` hay que creerse la cabecera, y la cabecera la
  // manda quien haga la petición. Detrás de Traefik es seguro —la reescribe
  // él—, pero si el contenedor quedara alcanzable por otro camino, alguien
  // podría mandarla a mano y conseguir que construyéramos la dirección de
  // vuelta apuntando a su servidor.
  //
  // Queda un cortafuegos más: auth solo acepta direcciones de vuelta que estén
  // en su lista blanca, así que una falsa la rechaza. Aun así, en producción
  // esto no debería pasar nunca — y si pasa, tiene que verse en el registro y
  // no descubrirse cuando alguien lo aproveche.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[login unico] PROCOVAR_PUBLIC_URL no esta configurada: la direccion publica ' +
        'se esta deduciendo de las cabeceras del proxy. Configurala.',
    )
  }

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const protocolo = req.headers.get('x-forwarded-proto') ?? 'https'
  if (host) return `${protocolo}://${host}`
  return new URL(req.url).origin
}

/**
 * A dónde se puede mandar a alguien después de entrar.
 *
 * Solo a esta misma aplicación. `volverA` viaja en la dirección y lo puede
 * escribir cualquiera: sin esta comprobación, un enlace del tipo
 * `…/api/auth/entrar?volverA=https://sitio-falso/` haría que, tras identificarse
 * de verdad en Procovar, la persona acabara en una copia del sistema pidiéndole
 * la contraseña — y habiendo pasado por nuestro dominio, que es justo lo que da
 * confianza.
 *
 * Se aceptan rutas (`/dashboard`) y direcciones completas de este mismo origen.
 * Cualquier otra cosa cae a `/dashboard`, en silencio: quien lo intenta no
 * merece una explicación y quien llega por error tampoco la necesita.
 */
export function destinoSeguro(candidato: string | null | undefined, origen: string): string {
  if (!candidato) return `${origen}/dashboard`

  // Una ruta relativa es segura por definición, pero `//otro-sitio.com` también
  // empieza por barra y el navegador la lee como otro dominio.
  if (candidato.startsWith('/') && !candidato.startsWith('//')) {
    return `${origen}${candidato}`
  }

  try {
    if (new URL(candidato).origin === origen) return candidato
  } catch {
    // No es una dirección válida.
  }
  return `${origen}/dashboard`
}
