import { NextRequest, NextResponse } from 'next/server'
import { pedirRedireccion, loginUnicoDisponible } from '@/lib/procovar-auth'

export const dynamic = 'force-dynamic'

/**
 * Empieza el login por el sistema único de Procovar.
 *
 * Manda a la persona a auth.procovar.cloud y le dice adónde volver. La dirección
 * de vuelta se calcula desde la petición y no desde una variable de entorno:
 * así funciona igual en local, en pruebas y en producción sin configurar nada, y
 * no hay forma de que apunte a un sitio que ya no existe.
 */
export async function GET(req: NextRequest) {
  if (!loginUnicoDisponible()) {
    // Sin la clave configurada no se puede ni empezar. Se vuelve al login de
    // siempre en vez de enseñar una pantalla de error: la gente tiene que poder
    // entrar aunque el enlace con auth esté a medio montar.
    return NextResponse.redirect(new URL('/login?sso=nodisponible', req.url))
  }

  const origen = new URL(req.url).origin
  const volverA = req.nextUrl.searchParams.get('volverA') ?? `${origen}/dashboard`

  try {
    const { redirectUrl } = await pedirRedireccion(`${origen}/api/auth/callback`, volverA)
    return NextResponse.redirect(redirectUrl)
  } catch {
    return NextResponse.redirect(new URL('/login?sso=error', req.url))
  }
}
