import { NextRequest, NextResponse } from 'next/server'
import { origenPublico } from '@/lib/origen-publico'

export const dynamic = 'force-dynamic'

/**
 * Cerrar sesión de verdad.
 *
 * Antes lo hacía el navegador: borraba el token de `localStorage` y mandaba a
 * `/login`. Desde que se entra por el login único eso ya no cierra nada — la
 * sesión vive en una cookie `httpOnly`, que el JavaScript no puede ni leer ni
 * borrar (y ha de ser así: un token que el navegador puede leer, cualquier
 * script de la página también). Así que quien le daba a "cerrar sesión" volvía a
 * entrar sin más, y pensaba que había salido.
 *
 * Eso importa en un ordenador compartido, que es exactamente donde se le da al
 * botón: la operadora se levanta creyendo que ha salido y la siguiente persona
 * se encuentra su sesión abierta.
 *
 * Se cierra en los dos sitios: se borra la cookie de aquí y se manda a cerrar
 * también en Accesos. Cerrar solo aquí dejaría la sesión de Procovar abierta, y
 * el botón de entrar la devolvería adentro sin pedirle nada.
 */
export async function GET(req: NextRequest) {
  const origen = origenPublico(req)
  const accesos = (process.env.PROCOVAR_AUTH_URL ?? 'https://auth.procovar.cloud').replace(/\/+$/, '')

  const res = NextResponse.redirect(`${accesos}/logout`)

  // `maxAge: 0` la borra. Los demás valores tienen que coincidir con los de
  // cuando se puso, o el navegador la trata como otra cookie distinta y deja la
  // buena donde estaba.
  res.cookies.set('token', '', {
    httpOnly: true,
    secure: origen.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
