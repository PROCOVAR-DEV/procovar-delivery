'use client'

import { useEffect, useRef, useState } from 'react'
import Navbar from '@/components/Navbar'
import { useAppStore } from '@/store/useAppStore'
import { Icon } from '@iconify/react'

interface SyncJob {
  externalId: string
  folio: string | null
  customerName: string | null
  status: string
  cost: number | null
  error: string | null
  updatedAt: string
}
interface Snapshot {
  counts: Record<string, number>
  total: number
  recent: SyncJob[]
  ready?: { ok: boolean; formulaOk: boolean; originOk: boolean }
  ts: number
}

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  pending: { label: 'En cola', cls: 'bg-amber-100 text-amber-800', icon: 'mdi:clock-outline' },
  processing: { label: 'Procesando', cls: 'bg-blue-100 text-blue-800', icon: 'mdi:progress-clock' },
  done: { label: 'Calculado', cls: 'bg-green-100 text-green-800', icon: 'mdi:check-circle' },
  skipped: { label: 'Omitido', cls: 'bg-gray-100 text-gray-700', icon: 'mdi:minus-circle' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-800', icon: 'mdi:alert-circle' },
}

export default function SyncPage() {
  const { token } = useAppStore()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [live, setLive] = useState(false)
  const esRef = useRef<EventSource | null>(null)

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

  const c = snap?.counts || {}
  const cards = [
    { k: 'pending', v: c.pending || 0 },
    { k: 'processing', v: c.processing || 0 },
    { k: 'done', v: c.done || 0 },
    { k: 'skipped', v: c.skipped || 0 },
    { k: 'error', v: c.error || 0 },
  ]

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

        <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map(({ k, v }) => (
            <div key={k} className="p-4 bg-white border rounded-xl">
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs mb-2 ${STATUS[k].cls}`}>
                <Icon icon={STATUS[k].icon} /> {STATUS[k].label}
              </div>
              <div className="text-3xl font-bold text-gray-900">{v}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border rounded-xl">
          <div className="px-4 py-3 border-b">
            <h2 className="font-semibold text-gray-800">Últimos pedidos procesados</h2>
          </div>
          <div className="divide-y">
            {(snap?.recent || []).length === 0 && (
              <div className="px-4 py-8 text-center text-gray-400">Sin actividad todavía.</div>
            )}
            {(snap?.recent || []).map((j) => {
              const s = STATUS[j.status] || STATUS.pending
              return (
                <div key={j.externalId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{j.folio || j.externalId}</p>
                    <p className="text-xs text-gray-500 truncate">{j.customerName || '—'}{j.error ? ` · ${j.error}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {j.cost != null && <span className="font-semibold text-gray-900">${j.cost}</span>}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${s.cls}`}>
                      <Icon icon={s.icon} /> {s.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
