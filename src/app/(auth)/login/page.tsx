import { redirect } from 'next/navigation'
import { Icon } from '@iconify/react'

export const dynamic = 'force-dynamic'

/**
 * Delivery ya no tiene login propio: se entra por el login único de Procovar.
 *
 * Una persona, una cuenta, una contraseña; y darla de baja en un sitio la da de
 * baja en todas.
 *
 * La página se queda en vez de borrarse porque `/login` está escrito en varios
 * sitios del código y en los marcadores de la gente: borrarla convertiría todo
 * eso en un 404 en lugar de en una entrada que funciona.
 *
 * **Y por eso mira primero si viene con un fallo.** Si algo sale mal,
 * `/api/auth/entrar` devuelve aquí con `?sso=…`; si esta página redirigiera
 * siempre, el navegador rebotaría entre las dos para siempre y nadie podría
 * entrar ni enterarse de por qué.
 */

const MOTIVOS: Record<string, string> = {
    nodisponible:
        'El acceso con la cuenta de Procovar todavía no está configurado en este servidor. Avisa a quien lleva el sistema.',
    error:
        'No se pudo conectar con el sistema de accesos de Procovar. Vuelve a intentarlo en un momento.',
    sincodigo:
        'La vuelta desde Procovar llegó incompleta. Vuelve a intentarlo.',
}

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ sso?: string }>
}) {
    const { sso } = await searchParams

    if (!sso) redirect('/api/auth/entrar')

    const motivo = MOTIVOS[sso] ?? MOTIVOS.error

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                <span className="mb-4 inline-flex h-14 w-14 items-center justify-center bg-[#054C74] text-white shadow-lg">
                    <Icon icon="mdi:truck-fast" className="text-3xl" />
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight text-ink">ProCovar</h1>
                <p className="mt-1 text-sm text-ink-soft">Optimización de rutas de reparto</p>

                <div className="mt-7 border border-line bg-white p-7 shadow-xl">
                    <p className="mb-5 border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        {motivo}
                    </p>
                    <a
                        href="/api/auth/entrar"
                        className="flex w-full items-center justify-center gap-2 bg-[#054C74] py-3 font-semibold text-white transition-colors hover:bg-[#04324C]"
                    >
                        <Icon icon="mdi:shield-account" className="text-xl" />
                        Volver a intentarlo
                    </a>
                </div>
            </div>
        </div>
    )
}
