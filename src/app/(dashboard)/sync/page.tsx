'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '@/components/Navbar'
import { useAppStore } from '@/store/useAppStore'
import { Icon } from '@iconify/react'
import axios from 'axios'

interface SyncJob {
  externalId: string
  folio: string | null
  customerName: string | null
  status: string
  cost: number | null
  distanceKm: number | null
  error: string | null
  attempts: number
  updatedAt: string
}
interface Snapshot {
  counts: Record<string, number>
  total: number
  ready?: { ok: boolean; formulaOk: boolean; originOk: boolean }
  ts: number
}
interface JobsResponse {
  jobs: SyncJob[]
  counts: Record<string, number>
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  pending: { label: 'En cola', cls: 'bg-amber-100 text-amber-800', icon: 'mdi:clock-outline' },
  processing: { label: 'Procesando', cls: 'bg-blue-100 text-blue-800', icon: 'mdi:progress-clock' },
  done: { label: 'Calculado', cls: 'bg-green-100 text-green-800', icon: 'mdi:check-circle' },
  skipped: { label: 'Omitido', cls: 'bg-gray-100 text-gray-700', icon: 'mdi:minus-circle' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-800', icon: 'mdi:alert-circle' },
}
const ORDER = ['pending', 'processing', 'done', 'skipped', 'error']

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function SyncPage() {
  const { token } = useAppStore()

  // Tarjetas + estado de config: en vivo por SSE.
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [live, setLive] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  // Tabla: filtros + paginación (REST).
  const [statusFilter, setStatusFilter] = useState('') // '' = todos
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<JobsResponse | null>(null)

  // --- SSE (contadores en vivo + aviso de configuración) ---
  useEffect(() => {
    if (!token) return
    const es = new EventSource(`/api/sync/stream?token=${encodeURIComponent(token)}`)
    esRef.current = es
    es.addEventListener('open', () => setLive(true))
    es.addEventListener('sync', (e) => {
      try { setSnap(JSON.parse((e as MessageEvent).data)) } catch { /* ignore */ }
    })
    es.addEventListener('error', () => setLive(false))
    return () => { es.close(); esRef.current = null }
  }, [token])

  // Debounce de la búsqueda.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  // Al cambiar filtro/búsqueda, volver a la página 1.
  useEffect(() => { setPage(1) }, [statusFilter, debouncedQ])

  const fetchJobs = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (statusFilter) params.set('status', statusFilter)
      if (debouncedQ) params.set('q', debouncedQ)
      const res = await axios.get(`/api/sync/jobs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setData(res.data as JobsResponse)
    } catch { /* transitorio; el próximo tick reintenta */ }
  }, [token, page, statusFilter, debouncedQ])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  // Auto-refresco de la tabla (para que quede en vivo como las tarjetas).
  useEffect(() => {
    const t = setInterval(fetchJobs, 3000)
    return () => clearInterval(t)
  }, [fetchJobs])

  const counts = snap?.counts || data?.counts || {}
  const pg = data?.pagination
  const jobs = data?.jobs || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar title="Sincronización" />
      <main className="max-w-6xl px-4 py-8 mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sincronización de domicilios</h1>
            <p className="text-sm text-gray-500">Cola de cálculo de costo de domicilio por pedido (en vivo).</p>
          </div>
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {live ? 'En vivo' : 'Conectando…'}
          </span>
        </div>

        {snap?.ready && !snap.ready.ok && (
          <div className="flex items-start gap-3 p-4 mb-6 border rounded-xl bg-amber-50 border-amber-200 text-amber-800">
            <Icon icon="mdi:pause-circle" className="text-2xl shrink-0" />
            <div>
              <p className="font-semibold">Cálculo en espera — falta configuración</p>
              <p className="text-sm">
                No se calculan domicilios hasta configurar:{' '}
                {!snap.ready.formulaOk && <b>la fórmula del domicilio (Ajustes)</b>}
                {!snap.ready.formulaOk && !snap.ready.originOk && ' y '}
                {!snap.ready.originOk && <b>el punto de partida del almacén (Sucursales)</b>}. Los pedidos quedan en cola.
              </p>
            </div>
          </div>
        )}

        {/* Tarjetas por estado — clic para filtrar la tabla */}
        <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-5">
          {ORDER.map((k) => {
            const activo = statusFilter === k
            return (
              <button
                key={k}
                onClick={() => setStatusFilter(activo ? '' : k)}
                className={`p-4 text-left bg-white border rounded-xl transition-all ${activo ? 'ring-2 ring-primary border-primary' : 'hover:border-gray-300'}`}
                title={activo ? 'Quitar filtro' : `Filtrar por ${STATUS[k].label}`}
              >
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs mb-2 ${STATUS[k].cls}`}>
                  <Icon icon={STATUS[k].icon} /> {STATUS[k].label}
                </div>
                <div className="text-3xl font-bold text-gray-900">{counts[k] || 0}</div>
              </button>
            )
          })}
        </div>

        {/* Filtros de la tabla */}
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Icon icon="mdi:magnify" className="absolute text-gray-400 -translate-y-1/2 left-3 top-1/2 text-lg" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por folio, cliente o id…"
              className="w-full py-2 pl-10 pr-3 text-sm bg-white border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos los estados</option>
            {ORDER.map((k) => (
              <option key={k} value={k}>{STATUS[k].label}</option>
            ))}
          </select>
          {(statusFilter || q) && (
            <button
              onClick={() => { setStatusFilter(''); setQ('') }}
              className="px-3 py-2 text-sm text-gray-600 border rounded-xl hover:bg-gray-100"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Tabla */}
        <div className="overflow-hidden bg-white border rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Pedido</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-right">Distancia</th>
                  <th className="px-4 py-3 text-right">Costo</th>
                  <th className="px-4 py-3 text-center">Intentos</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      Sin resultados con estos filtros.
                    </td>
                  </tr>
                )}
                {jobs.map((j) => {
                  const s = STATUS[j.status] || STATUS.pending
                  return (
                    <tr key={j.externalId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{j.folio || j.externalId}</td>
                      <td className="max-w-[220px] px-4 py-3 text-gray-600 truncate" title={j.customerName || ''}>
                        {j.customerName || '—'}
                        {j.error && <span className="block text-xs text-red-500 truncate">{j.error}</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-right text-gray-700">{j.distanceKm != null ? `${j.distanceKm.toFixed(1)} km` : '—'}</td>
                      <td className="px-4 py-3 font-mono text-right text-gray-900">{j.cost != null ? `$${j.cost.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{j.attempts}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${s.cls}`}>
                          <Icon icon={s.icon} /> {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">{fmtTime(j.updatedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {pg && pg.total > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-gray-50/60">
              <span className="text-xs text-gray-500">
                {(pg.page - 1) * pg.limit + 1}–{Math.min(pg.page * pg.limit, pg.total)} de {pg.total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={pg.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100"
                >
                  <Icon icon="mdi:chevron-left" className="text-lg" />
                </button>
                <span className="px-2 text-sm text-gray-600">{pg.page} / {pg.totalPages}</span>
                <button
                  disabled={pg.page >= pg.totalPages}
                  onClick={() => setPage((p) => Math.min(pg.totalPages, p + 1))}
                  className="p-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100"
                >
                  <Icon icon="mdi:chevron-right" className="text-lg" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
