import { createHash, createHmac, randomBytes } from 'crypto'

/**
 * Cliente del login único de Procovar (auth.procovar.cloud).
 *
 * Delivery deja de tener su propia lista de personas y su propia contraseña:
 * quien entra se identifica en auth, y aquí solo se comprueba quién es. Una
 * persona, una cuenta, una contraseña — y darla de baja en un sitio la da de
 * baja en todos.
 *
 * # Lo que NO cambia
 *
 * Por dentro, delivery sigue emitiendo su mismo token de siempre. Los cuarenta y
 * pico endpoints que ya comprueban `getUserFromRequest` no se tocan. Cambiar a
 * la vez la puerta de entrada y todas las cerraduras de dentro es la forma
 * segura de romper algo sin saber cuál de las dos cosas fue.
 *
 * # La firma
 *
 * Cada petición va firmada con HMAC-SHA256 sobre
 * `MÉTODO\nruta\nmarca-de-tiempo\nnonce\nhash-del-cuerpo`. La clave la deriva
 * auth por aplicación, así que la de delivery no sirve para hacerse pasar por
 * PEDIDO. El nonce y la marca de tiempo son contra la repetición: auth rechaza
 * una firma repetida o con más de cinco minutos.
 */

const AUTH_URL = process.env.PROCOVAR_AUTH_URL ?? 'https://auth.procovar.cloud'
const CLIENT_ID = process.env.PROCOVAR_AUTH_CLIENT_ID ?? 'delivery'
const SIGNING_KEY = process.env.PROCOVAR_AUTH_SIGNING_KEY ?? ''

export interface PersonaDeAuth {
  id: string
  email: string
  name: string
  /** Roles que tiene, con el nombre exacto de Procovar (`SUPERVISOR`, …). */
  roles: string[]
  /** El código de su sucursal (CAM, HOL…), o null si es global. */
  codigoSucursal: string | null
  esSuperAdmin: boolean
}

export function loginUnicoDisponible(): boolean {
  return Boolean(SIGNING_KEY)
}

function firmar(metodo: string, ruta: string, cuerpo: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const hashCuerpo = createHash('sha256').update(cuerpo).digest('hex')
  const aFirmar = [metodo.toUpperCase(), ruta, ts, nonce, hashCuerpo].join('\n')
  const firma = createHmac('sha256', Buffer.from(SIGNING_KEY, 'hex')).update(aFirmar).digest('hex')

  return {
    'x-client-id': CLIENT_ID,
    'x-timestamp': ts,
    'x-nonce': nonce,
    'x-signature': firma,
    'content-type': 'application/json',
  }
}

/**
 * Una llamada GET firmada a Accesos.
 *
 * El resto de esta aplicación habla con Accesos por POST —el canje del código del login—,
 * pero la tasa de cambio es una LECTURA y hacerla por POST sería mentir sobre lo que hace.
 * La firma es la misma: sobre el método, la ruta con su query, la hora, un nonce y el
 * hash del cuerpo, que en un GET es el de la cadena vacía.
 */
export async function pedirFirmado<T>(ruta: string): Promise<T> {
  if (!SIGNING_KEY) throw new Error('PROCOVAR_AUTH_SIGNING_KEY no está configurada')

  const res = await fetch(new URL(ruta, AUTH_URL).toString(), {
    method: 'GET',
    headers: firmar('GET', ruta, ''),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`auth ${res.status}: ${(await res.text()).slice(0, 120)}`)

  return (await res.json()) as T
}

async function llamar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  if (!SIGNING_KEY) throw new Error('PROCOVAR_AUTH_SIGNING_KEY no está configurada')

  const texto = JSON.stringify(cuerpo)
  const res = await fetch(new URL(ruta, AUTH_URL).toString(), {
    method: 'POST',
    headers: firmar('POST', ruta, texto),
    body: texto,
  })
  const bruto = await res.text()
  let datos: unknown
  try {
    datos = bruto ? JSON.parse(bruto) : {}
  } catch {
    datos = { raw: bruto }
  }
  if (!res.ok) {
    const d = datos as { error?: string; message?: string }
    throw new Error(`auth ${res.status}: ${d.message ?? d.error ?? bruto.slice(0, 120)}`)
  }
  return datos as T
}

/** Pide la dirección a la que hay que mandar a la persona para que se identifique. */
export function pedirRedireccion(callbackUrl: string, returnTo: string) {
  return llamar<{ redirectUrl: string }>('/api/auth/callback-token', {
    clientId: CLIENT_ID,
    callbackUrl,
    returnTo,
  })
}

interface RespuestaCanje {
  user?: { id: string; email: string; name?: string | null; isSystemAdmin?: boolean }
  memberships?: Array<{
    organization?: { slug?: string; name?: string }
    roles?: string[]
  }>
  returnTo?: string | null
}

/** Cambia el código que trae de vuelta por quién es esa persona. */
export async function canjearCodigo(code: string): Promise<PersonaDeAuth & { returnTo: string | null }> {
  const r = await llamar<RespuestaCanje>('/api/auth/exchange', { code })

  if (!r.user?.id || !r.user.email) throw new Error('auth no devolvió la persona')

  // Una persona puede estar en varias sucursales; delivery solo guarda una.
  // Se toma la primera, que auth devuelve ordenadas de la más reciente a la más
  // antigua. Para quien lleve dos sucursales habrá que decidir cómo se elige —
  // hoy no hay nadie así, y adivinarlo ahora sería inventar la regla.
  const principal = r.memberships?.[0]

  // El `slug` de la organización ES el código de la sucursal en minúscula
  // (`cam`, `hol`). Es lo único que ata a esta persona con una `Branch` de
  // aquí: los identificadores internos de cada aplicación no se parecen en nada.
  const codigo = principal?.organization?.slug?.toUpperCase() ?? null

  return {
    id: r.user.id,
    email: r.user.email,
    name: r.user.name ?? r.user.email,
    roles: principal?.roles ?? [],
    codigoSucursal: codigo,
    esSuperAdmin: Boolean(r.user.isSystemAdmin),
    returnTo: r.returnTo ?? null,
  }
}

/**
 * De los roles de Procovar al rol que delivery entiende.
 *
 * Delivery solo distingue `admin` y `operator`, y su comprobación es literal
 * (`role !== 'admin'`). Traducir aquí —en un solo sitio— evita tener que tocar
 * cada pantalla y cada endpoint el día que cambien los roles de Procovar.
 *
 * Se cae hacia `operator`, nunca hacia `admin`: un rol que no conozcamos no
 * puede acabar dando más permisos de los debidos.
 */
export function rolDeDelivery(persona: PersonaDeAuth): 'admin' | 'operator' {
  if (persona.esSuperAdmin) return 'admin'
  const mandan = new Set(['SUPER ADMIN', 'ADMINISTRADOR'])
  return persona.roles.some((r) => mandan.has(r.toUpperCase())) ? 'admin' : 'operator'
}
