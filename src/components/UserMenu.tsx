'use client'

/**
 * El avatar, que ahora abre un menú.
 *
 * Cerrar sesión estaba abajo del todo de la barra lateral, junto a las pantallas de la
 * aplicación, como si fuera una más. No lo es: no es un sitio al que ir, es algo que le
 * pasa a tu cuenta. Y en la barra hacía dos cosas malas — ocupaba el sitio de una
 * pantalla y estaba a un resbalón del ratón de «Configuración».
 *
 * Aquí dentro va lo de la cuenta y nada más: quién eres, a qué otras aplicaciones puedes
 * ir, y salir. La lista de aplicaciones la decide el servidor (`/api/apps`), no esta
 * pantalla: filtrarla aquí por el rol que lleva el navegador es enseñarle el mapa
 * completo a quien edite ese valor.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { useAppStore } from '@/store/useAppStore'

interface App {
  href: string
  icon: string
  title: string
  description: string
}

export default function UserMenu() {
  const { user, token, logout } = useAppStore()
  const [abierto, setAbierto] = useState(false)
  const [montado, setMontado] = useState(false)
  const anclaRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  useEffect(() => { setMontado(true) }, [])

  // Las aplicaciones se piden UNA vez y sólo cuando se abre el menú: no hace falta
  // consultarlas en cada pantalla para pintar un avatar.
  const { data } = useQuery({
    queryKey: ['apps'],
    queryFn: async () => {
      const res = await axios.get('/api/apps', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as { apps: App[] }
    },
    enabled: !!token && abierto,
    staleTime: 30 * 60 * 1000,
  })

  const apps = data?.apps ?? []

  /**
   * El menú se pinta en `document.body`, no aquí.
   *
   * La barra de arriba es `sticky` y el contenido tiene `transform`: un menú absoluto
   * dentro se recorta contra el borde de la barra. Por portal se ve entero, y la
   * posición se calcula a partir del botón.
   */
  useEffect(() => {
    if (!abierto) return

    const colocar = () => {
      const r = anclaRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }

    colocar()
    window.addEventListener('resize', colocar)
    window.addEventListener('scroll', colocar, true)
    return () => {
      window.removeEventListener('resize', colocar)
      window.removeEventListener('scroll', colocar, true)
    }
  }, [abierto])

  // Se cierra al pulsar fuera y con Escape: un menú que sólo se cierra con su propio
  // botón acaba abierto encima de lo que el usuario quería leer.
  useEffect(() => {
    if (!abierto) return

    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || anclaRef.current?.contains(t)) return
      setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }

    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const salir = () => {
    // Se limpia lo del navegador y se manda a Accesos, que pregunta y cierra: la sesión
    // está en una cookie httpOnly que el JavaScript no puede borrar, así que sin esta
    // llamada esto limpiaba localStorage y no cerraba nada.
    logout()
    window.location.assign('/api/auth/logout')
  }

  return (
    <>
      <button
        ref={anclaRef}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Tu cuenta"
        data-testid="user-menu-button"
        className={`flex items-center gap-2.5 pl-2 ml-1 border-l border-line rounded-xl py-1 pr-1 transition-colors ${
          abierto ? 'bg-ink/[0.04]' : 'hover:bg-ink/[0.03]'
        }`}
      >
        <div className="text-right leading-tight hidden sm:block">
          <p className="text-sm font-semibold text-ink">{user?.name || 'User'}</p>
          <p className="text-[11px] uppercase tracking-wider text-ink-soft/70">{user?.role || 'admin'}</p>
        </div>
        <div className="w-9 h-9 bg-gradient-to-br from-primary to-[#0E9F6E] rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-md">
          {user?.name?.[0]?.toUpperCase() || 'U'}
        </div>
        <Icon icon="mdi:chevron-down" className={`text-ink-soft/50 text-base transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && montado && createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid="user-menu"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-80 max-w-[calc(100vw-1rem)] bg-white border border-line rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-line bg-ink/[0.02]">
            <p className="text-sm font-semibold text-ink truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-ink-soft/70 truncate">{user?.email}</p>
          </div>

          {/* Alto de sobra para que la última aplicación no quede cortada por la mitad:
              una lista que parece terminar donde no termina es una lista incompleta. */}
          {apps.length > 0 && (
            <div className="max-h-[62vh] overflow-y-auto py-1.5">
              <p className="px-4 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-ink-soft/50 font-semibold">
                Ir a
              </p>
              {apps.map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  className="flex items-start gap-3 px-4 py-2 hover:bg-ink/[0.035] transition-colors"
                >
                  <Icon icon={a.icon} className="text-lg text-ink-soft/70 shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{a.title}</span>
                    <span className="block text-[11px] text-ink-soft/70 truncate">{a.description}</span>
                  </span>
                  <Icon icon="mdi:open-in-new" className="text-xs text-ink-soft/40 shrink-0 mt-1" />
                </a>
              ))}
            </div>
          )}

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={salir}
              role="menuitem"
              data-testid="logout"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Icon icon="mdi:logout" className="text-lg" />
              Cerrar sesión
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
