'use client'

import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'

/**
 * Paginación en cliente reutilizable para las listas de delivery (ninguna la tenía).
 * `usePagedList` recibe el arreglo YA filtrado y devuelve la página actual + controles.
 * Resetea a la página 1 cuando cambia el tamaño de la lista (p.ej. al buscar/filtrar).
 */
export function usePagedList<T>(items: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  )
  return {
    pageItems,
    page: current,
    setPage,
    pageSize,
    setPageSize: (n: number) => { setPageSize(n); setPage(1) },
    total,
    totalPages,
    from: total === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, total),
  }
}

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  from: number
  to: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize?: (n: number) => void
  pageSizeOptions?: number[]
}

export default function Pagination({
  page, totalPages, total, from, to, pageSize, onPage, onPageSize,
  pageSizeOptions = [25, 50, 100],
}: PaginationProps) {
  if (total === 0) return null

  // Ventana de números de página (máx 5) alrededor de la actual.
  const win: number[] = []
  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  const end = Math.min(totalPages, start + 4)
  for (let i = start; i <= end; i++) win.push(i)

  const btn = 'min-w-8 h-8 px-2 rounded-lg text-sm border transition disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t bg-white">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span>Mostrando <b className="text-gray-700">{from}–{to}</b> de <b className="text-gray-700">{total}</b></span>
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="ml-2 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / pág.</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button className={btn} onClick={() => onPage(1)} disabled={page <= 1} aria-label="Primera">
          <Icon icon="mdi:chevron-double-left" />
        </button>
        <button className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Anterior">
          <Icon icon="mdi:chevron-left" />
        </button>
        {win.map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`${btn} ${p === page ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
          >
            {p}
          </button>
        ))}
        <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Siguiente">
          <Icon icon="mdi:chevron-right" />
        </button>
        <button className={btn} onClick={() => onPage(totalPages)} disabled={page >= totalPages} aria-label="Última">
          <Icon icon="mdi:chevron-double-right" />
        </button>
      </div>
    </div>
  )
}
