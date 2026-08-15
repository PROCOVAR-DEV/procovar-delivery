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
 * Se cierra en los dos sitios, y en este orden: primero se manda a Accesos, que
 * es donde vive la sesión y donde está el cartel de "¿seguro?", y la cookie de
 * aquí se borra al VOLVER (`/api/auth/logout/done`).
 *
 * El orden importa. Antes se borraba la cookie ANTES de ir, y entonces decir que
 * no en el cartel dejaba a la persona a medias: sesión de Accesos abierta pero
 * sin cookie aquí, o sea fuera de la aplicación por haber dicho que no quería
 * salir. Ahora cancelar no toca nada.
 */
export async function GET(req: NextRequest) {
    const origen = origenPublico(req)
    const accesos = (process.env.PROCOVAR_AUTH_URL ?? 'https://auth.procovar.cloud').replace(/\/+$/, '')

    const params = new URLSearchParams({
        returnTo: `${origen}/api/auth/logout/done`,
        cancelUrl: `${origen}/`,
    })
    return NextResponse.redirect(`${accesos}/logout?${params.toString()}`)
}
