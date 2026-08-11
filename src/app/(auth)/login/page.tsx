'use client'

import { useState } from 'react'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser, setToken } = useAppStore()
  const t = useT()
  const router = useRouter()

  // Si el login único devolvió a esta pantalla, dice por qué. Sin esto, quien
  // pulsa "Entrar con Procovar" y vuelve aquí sin más cree que ha pulsado mal.
  const motivoSso =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('sso')
      : null
  const AVISOS: Record<string, string> = {
    nodisponible: 'El acceso con la cuenta de Procovar todavía no está configurado. Entra con tu correo y contraseña.',
    error: 'No se pudo entrar con la cuenta de Procovar. Inténtalo otra vez o entra con tu correo y contraseña.',
    sincodigo: 'La vuelta desde Procovar llegó incompleta. Vuelve a intentarlo.',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await axios.post('/api/auth/login', { email, password })
      setToken(res.data.token)
      setUser(res.data.user)
      router.push('/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || t('login.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* atmospheric gradient mesh */}
      <div className="pointer-events-none absolute inset-0 -z-0"
        style={{ background: 'radial-gradient(60% 50% at 15% 10%, rgba(31,79,224,0.10), transparent 70%), radial-gradient(55% 45% at 90% 90%, rgba(14,159,110,0.10), transparent 70%)' }} />
      <div className="relative z-10 w-full max-w-md animate-rise">
        <div className="text-center mb-7">
          <span className="inline-flex w-14 h-14 rounded-2xl bg-primary text-white items-center justify-center shadow-lg mb-4">
            <Icon icon="mdi:truck-fast" className="text-3xl" />
          </span>
          <h1 className="text-4xl font-extrabold text-ink tracking-tight">ProCovar</h1>
          <p className="text-ink-soft mt-2 text-sm">{t('login.subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* La entrada de la casa va primero y en grande: quien tiene cuenta de
              Procovar es todo el mundo, y el correo y la contraseña de aquí son
              ya solo la puerta de atrás para cuando algo falle. */}
          <a
            href="/api/auth/entrar"
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#054C74] py-3 font-semibold text-white shadow-md transition-colors hover:bg-[#04324C]"
          >
            <Icon icon="mdi:shield-account" className="text-xl" />
            Entrar con mi cuenta de Procovar
          </a>

          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs uppercase tracking-wider text-ink-soft/70">o</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {motivoSso && AVISOS[motivoSso] && (
            <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {AVISOS[motivoSso]}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">{t('login.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-line rounded-xl bg-paper/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-white transition-colors"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">{t('login.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-line rounded-xl bg-paper/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-white transition-colors font-mono"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-3 rounded-xl font-semibold hover:bg-[#1840bd] transition-colors disabled:opacity-50 shadow-md"
            >
              {loading ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>

          <p className="text-center text-sm text-ink-soft/80 mt-6">
            {t('login.adminNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
