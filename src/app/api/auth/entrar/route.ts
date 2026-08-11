import { NextRequest, NextResponse } from 'next/server'
import { pedirRedireccion, loginUnicoDisponible } from '@/lib/procovar-auth'
import { origenPublico } from '@/lib/origen-publico'

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
  const origen = origenPublico(req)

  if (!loginUnicoDisponible()) {
    // Sin la clave configurada no se puede ni empezar. Se vuelve al login de
    // siempre en vez de enseñar una pantalla de error: la gente tiene que poder
    // entrar aunque el enlace con auth esté a medio montar.
    return NextResponse.redirect(`${origen}/login?sso=nodisponible`)
  }

  const volverA = req.nextUrl.searchParams.get('volverA') ?? `${origen}/dashboard`

  try {
    const { redirectUrl } = await pedirRedireccion(`${origen}/api/auth/callback`, volverA)
    return NextResponse.redirect(redirectUrl)
  } catch (e) {
    // El motivo va al registro, no a la pantalla: a quien entra no le sirve de
    // nada, y a quien lo arregla le hace falta entero. Sin esto, un fallo aquí
    // es un "sso=error" mudo.
    console.error('[login unico] no se pudo pedir la redireccion:', (e as Error).message)
    return NextResponse.redirect(`${origen}/login?sso=error`)
  }
}
