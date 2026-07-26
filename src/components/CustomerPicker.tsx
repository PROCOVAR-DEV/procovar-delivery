'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { Icon } from '@iconify/react'

export interface Customer {
  id: string
  externalId: string
  name: string
  address?: string | null
  municipio?: string | null
  zona?: string | null
  lat: number
  lng: number
  sucursalCodigo?: string | null
}

/**
 * Combobox de clientes espejados de PEDIDO (solo geolocalizados). Al elegir uno,
 * onPick devuelve el cliente con su geo → el form autocompleta nombre + dirección +
 * lat/lng y ya se puede cotizar. El mirror lo mantiene sync-queue.mjs automáticamente.
 */
export default function CustomerPicker({ onPick }: { onPick: (c: Customer) => void }) {
  const { token } = useAppStore()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await axios.get('/api/customers', { headers: { Authorization: `Bearer ${token}` } })
      return (res.data?.customers ?? []) as Customer[]
    },
    enabled: !!token,
  })

  const q = query.trim().toLowerCase()
  const matches = q
    ? customers
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.address || '').toLowerCase().includes(q) ||
            (c.municipio || '').toLowerCase().includes(q),
        )
        .slice(0, 30)
    : customers.slice(0, 8)

  return (
    <div className="relative">
      <div className="relative">
        <Icon icon="mdi:account-search" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/50" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar cliente (de PEDIDO, con geolocalización)…"
          className="w-full pl-9 pr-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white rounded-xl border border-line shadow-xl z-30 p-1">
            {isLoading ? (
              <p className="text-xs text-ink-soft/70 px-3 py-3 text-center">Cargando…</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-ink-soft/70 px-3 py-3 text-center">
                {customers.length === 0
                  ? 'No hay clientes geolocalizados todavía (se sincronizan solos desde PEDIDO).'
                  : 'Sin resultados.'}
              </p>
            ) : (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft/60 px-3 pt-1.5 pb-1">
                  {q ? 'Resultados' : 'Clientes'}
                </p>
                {matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onPick(c)
                      setQuery('')
                      setOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/[0.06] flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-ink-soft/60 truncate">
                        {[c.address, c.municipio].filter(Boolean).join(' · ') || 'Sin dirección'}
                      </p>
                    </div>
                    <Icon icon="mdi:map-marker-check" className="text-green-500 shrink-0 mt-0.5" />
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
