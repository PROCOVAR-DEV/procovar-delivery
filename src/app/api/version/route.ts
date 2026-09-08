import { NextResponse } from 'next/server'

/**
 * La version que sirve ESTE contenedor.
 *
 * `process.env.VERSION_APP` no se lee en ejecución: Next lo sustituye por un literal
 * al compilar (está declarado en `env` de next.config.js). Por eso vale para lo que
 * vale — el JavaScript que corre en el navegador lleva incrustado el literal del build
 * del que salió, y este endpoint devuelve el del build que está desplegado ahora. Si no
 * son iguales, esa pestaña tiene una versión vieja.
 *
 * `force-dynamic` + `no-store` porque una respuesta cacheada aquí diría "estás al día"
 * para siempre, que es el único fallo que este endpoint no se puede permitir.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { version: process.env.VERSION_APP ?? null },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  )
}
