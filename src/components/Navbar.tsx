'use client'

import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'

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
  const { user, token, language, setLanguage, sucursalId, setSucursalId } = useAppStore()
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

  // Admin GLOBAL = usuario SIN sucursal asignada (ve todas y puede elegir). Un usuario
  // con sucursal (branchId) queda fijo a la suya, aunque su rol sea 'admin'.
  const isAdmin = !user?.branchId
  const ownBranch = branches.find((b) => b.id === user?.branchId)
  const activeBranch = sucursalId ? branches.find((b) => b.id === sucursalId) : null
  const activeBranchName = sucursalId
    ? (branchLabel(activeBranch) || 'Sucursal')
    : 'Todas las sucursales'

  return (
    <div className="h-16 bg-paper/80 backdrop-blur border-b border-line px-6 flex items-center justify-between sticky top-0 z-20">
      <h2 className="text-[1.4rem] font-bold text-ink tracking-tight">{title}</h2>
      <div className="flex items-center gap-2.5">
        {branches.length > 0 && (
          <div className="flex items-center gap-1 bg-white border border-line rounded-xl pl-2.5 pr-1.5 py-1 shadow-sm">
            <Icon icon="mdi:store-outline" className="text-ink-soft/60 text-base" />
            {isAdmin ? (
              <select
                value={sucursalId ?? ''}
                onChange={(e) => {
                  setSucursalId(e.target.value || null)
                  // Recarga para que TODAS las vistas re-consulten scopeadas a la sucursal.
                  if (typeof window !== 'undefined') window.location.reload()
                }}
                className="text-xs font-semibold bg-transparent text-ink py-1 pr-0.5 focus:outline-none cursor-pointer max-w-[160px]"
                title={activeBranchName}
              >
                <option value="">Todas las sucursales</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{branchLabel(b)}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-ink py-1 pr-0.5 max-w-[160px] truncate">
                {ownBranch ? branchLabel(ownBranch) : activeBranchName}
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
        <div className="flex items-center gap-2.5 pl-2 ml-1 border-l border-line">
          <div className="text-right leading-tight">
            <p className="text-sm font-semibold text-ink">{user?.name || 'User'}</p>
            <p className="text-[11px] uppercase tracking-wider text-ink-soft/70">{user?.role || 'admin'}</p>
          </div>
          <div className="w-9 h-9 bg-gradient-to-br from-primary to-[#0E9F6E] rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-md">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
        </div>
      </div>
    </div>
  )
}
