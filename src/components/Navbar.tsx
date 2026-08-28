'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import UserMenu from '@/components/UserMenu'

interface Branch {
  id: string
  name: string
  externalId?: string | null
}

// Muestra "nombre (CÓDIGO)" si la sucursal tiene código.
function branchLabel(b?: Branch | null) {
  if (!b) return ''
  return b.externalId ? `${b.name} (${b.externalId})` : b.name
}

export default function Navbar({ title }: { title: string }) {
  const { token, language, setLanguage, sucursalId, setSucursalId } = useAppStore()
  const { code, currencies, setDisplayCurrency } = useCurrency()
  const t = useT()

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Branch[]
    },
    enabled: !!token,
  })

  /**
   * Quién ve el selector: quien puede ver MÁS DE UNA sucursal.
   *
   * Antes se decidía por `user.branchId` —«si no tiene sucursal, es admin»—, y eso lo
   * decide el navegador con lo que lleva el token. El token dura siete días y puede traer
   * una sucursal que ya no existe: entonces el servidor devuelve todas y la barra seguía
   * enseñando el nombre fijo de una sucursal muerta.
   *
   * Lo que manda es lo que el servidor deja ver. `/api/branches` devuelve exactamente
   * eso: si vienen varias, hay selector; si viene una, se enseña su nombre y ya —sin
   * "todas las sucursales", que para quien lleva una no significa nada—; y si no viene
   * ninguna, no se enseña nada en vez de un desplegable vacío.
   */
  const variasSucursales = branches.length > 1
  const unica = branches.length === 1 ? branches[0] : null

  /**
   * Y si la elegida ya no está entre las que se pueden ver, se olvida.
   *
   * Pasa al cambiar de cuenta o cuando se recrean las sucursales: el navegador guarda un
   * id que esta persona ya no puede elegir, y el selector se queda enseñando un valor que
   * no está en la lista — en blanco, y filtrando por algo que nadie ve.
   */
  useEffect(() => {
    if (!branches.length || !sucursalId) return
    if (!branches.some((b) => b.id === sucursalId)) setSucursalId(null)
  }, [branches, sucursalId, setSucursalId])

  return (
    <div className="h-16 bg-paper/80 backdrop-blur border-b border-line px-6 flex items-center justify-between sticky top-0 z-20">
      <h2 className="text-[1.4rem] font-bold text-ink tracking-tight">{title}</h2>
      <div className="flex items-center gap-2.5">
        {branches.length > 0 && (
          <div className="flex items-center gap-1 bg-white border border-line rounded-xl pl-2.5 pr-1.5 py-1 shadow-sm">
            <Icon icon="mdi:store-outline" className="text-ink-soft/60 text-base" />
            {variasSucursales ? (
              <select
                value={sucursalId ?? ''}
                onChange={(e) => {
                  setSucursalId(e.target.value || null)
                  // Recarga para que TODAS las vistas re-consulten scopeadas a la sucursal.
                  if (typeof window !== 'undefined') window.location.reload()
                }}
                className="text-xs font-semibold bg-transparent text-ink py-1 pr-0.5 focus:outline-none cursor-pointer max-w-[180px]"
                title={sucursalId ? branchLabel(branches.find((b) => b.id === sucursalId)) : 'Todas las sucursales'}
              >
                <option value="">Todas las sucursales ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{branchLabel(b)}</option>
                ))}
              </select>
            ) : (
              // Una sola: se dice cuál es y no se ofrece elegir. No hay nada que elegir.
              <span className="text-xs font-semibold text-ink py-1 pr-0.5 max-w-[180px] truncate">
                {branchLabel(unica)}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 bg-white border border-line rounded-xl pl-2.5 pr-1.5 py-1 shadow-sm">
          <Icon icon="mdi:translate" className="text-ink-soft/60 text-base" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}
            className="text-xs font-semibold bg-transparent text-ink py-1 pr-0.5 focus:outline-none cursor-pointer"
            title={t('navbar.language')}
          >
            <option value="es">ES</option>
            <option value="en">EN</option>
          </select>
        </div>
        <div className="flex items-center gap-1 bg-white border border-line rounded-xl pl-2.5 pr-1.5 py-1 shadow-sm">
          <Icon icon="mdi:cash-multiple" className="text-ink-soft/60 text-base" />
          <select
            value={code}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="text-xs font-semibold font-mono bg-transparent text-ink py-1 pr-0.5 focus:outline-none cursor-pointer"
            title={t('navbar.currency')}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </div>
        {/* El avatar abre el menú de la cuenta: quién eres, ir a otra aplicación y salir.
            Antes esto era un adorno y cerrar sesión estaba abajo de la barra lateral,
            entre las pantallas, como si fuera un sitio al que ir. */}
        <UserMenu />
      </div>
    </div>
  )
}
