'use client'

import Sidebar from '@/components/Sidebar'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { token } = useAppStore()
  const router = useRouter()

  useEffect(() => {
    // Tras un reload, el store aún no hidrató el token del store desde localStorage.
    // Solo mandamos a /login si NO hay sesión ni en el store ni en localStorage
    // (si no, estaríamos botando al usuario en cada refresco mientras hidrata).
    const stored = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token && !stored) {
      router.push('/login')
    }
  }, [token, router])

  // Si el store aún no tiene token pero localStorage sí, estamos hidratando: no mostramos
  // nada todavía (se re-renderiza en cuanto el token cargue), sin redirigir.
  if (!token) return null

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-64 animate-rise">
        {children}
      </div>
    </div>
  )
}
