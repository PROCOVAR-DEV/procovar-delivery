import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Quién está dentro, según el servidor.
 *
 * Hace falta desde que se entra por el login único: ahí el token llega en una
 * cookie que el navegador guarda solo y que el JavaScript no puede leer (es
 * `httpOnly`, y ha de serlo — un token que el navegador puede leer, cualquier
 * script de la página también). Así que el navegador no tiene forma de saber si
 * hay sesión sin preguntar.
 *
 * Devuelve también el token para que el resto de la aplicación siga poniéndolo
 * en la cabecera `Authorization` como hasta ahora, sin cambiar cada llamada.
 */
export async function GET(req: NextRequest) {
  const usuario = getUserFromRequest(req)
  if (!usuario) return NextResponse.json({ user: null }, { status: 401 })

  const token = req.cookies.get('token')?.value ?? null
  return NextResponse.json({ user: usuario, token })
}
