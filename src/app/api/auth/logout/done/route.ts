import { NextRequest, NextResponse } from 'next/server'
import { origenPublico } from '@/lib/origen-publico'

export const dynamic = 'force-dynamic'

/**
 * La vuelta de Accesos, ya cerrada la sesión de allí. Aquí solo queda borrar la
 * cookie de esta aplicación y dejar a la persona en la puerta.
 */
export async function GET(req: NextRequest) {
    const origen = origenPublico(req)
    const res = NextResponse.redirect(`${origen}/`)

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
