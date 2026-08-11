'use client'

import Sidebar from '@/components/Sidebar'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { token, setToken, setUser } = useAppStore()
  const router = useRouter()
  const [comprobando, setComprobando] = useState(true)

  useEffect(() => {
    let vivo = true

    // Tras un reload el store todavía no ha leído el token de localStorage: si
    // se mirara solo el store, se echaría a la gente en cada refresco.
    const guardado = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (token || guardado) {
      setComprobando(false)
      return
    }

    // Sin nada en localStorage puede que aun así haya sesión: quien entra por el
    // login único la tiene en una cookie que el JavaScript no puede leer. Antes
    // de mandar a nadie al login, se le pregunta al servidor.
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return
        if (d?.user && d?.token) {
          setToken(d.token)
          setUser(d.user)
          setComprobando(false)
        } else {
          router.push('/login')
        }
      })
      .catch(() => {
        if (vivo) router.push('/login')
      })

    return () => {
      vivo = false
    }
  }, [token, router, setToken, setUser])

  // Mientras se comprueba no se enseña nada: ni la pantalla ni un salto al
  // login. Un parpadeo hacia el login y de vuelta se lee como un fallo.
  if (comprobando || !token) return null

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-64 animate-rise">
        {children}
      </div>
    </div>
  )
}
