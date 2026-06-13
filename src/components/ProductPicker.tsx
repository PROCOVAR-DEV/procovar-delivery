'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

export interface Product {
  id: string
  name: string
  weight: number
  packaging?: string | null
  unitsPerPackage?: number | null
  category?: string | null
  usageCount?: number
}

/** Searchable product combobox. Calls onPick with the chosen product. */
export default function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const { token } = useAppStore()
  const t = useT()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await axios.get('/api/products', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Product[]
    },
    enabled: !!token,
  })

  const q = query.trim().toLowerCase()
  const byUsage = (a: Product, b: Product) => (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name)

  // No query → the 5 most-transported products. With a query → search the whole catalog.
  const matches = q
    ? products
        .filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q) || (p.packaging || '').toLowerCase().includes(q))
        .sort(byUsage)
        .slice(0, 30)
    : [...products].sort(byUsage).slice(0, 5)

  return (
    <div className="relative">
      <div className="relative">
        <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/50" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={t('prod.search')}
          className="w-full pl-9 pr-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white rounded-xl border border-line shadow-xl z-30 p-1">
            {matches.length === 0 ? (
              <p className="text-xs text-ink-soft/70 px-3 py-3 text-center">{t('prod.none')}</p>
            ) : (
              <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft/60 px-3 pt-1.5 pb-1 flex items-center gap-1">
                {!q && <Icon icon="mdi:fire" className="text-accent text-xs" />}{q ? t('prod.allResults') : t('prod.topUsed')}
              </p>
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onPick(p); setQuery(''); setOpen(false) }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/[0.06] flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium block truncate">{p.name}</span>
                    <span className="text-[11px] text-ink-soft/70 truncate block">
                      {p.packaging ? `${p.packaging} · ` : ''}{p.category || ''}
                    </span>
                  </span>
                  <span className="text-xs font-mono text-ink-soft shrink-0">{p.weight} kg</span>
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
