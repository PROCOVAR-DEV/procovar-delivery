import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { redisEnabled, getSubscriber, CH_SYNC_CHANGED } from '@/lib/redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SSE: transmite el estado de la cola de sincronización (SyncJob) en vivo.
// "Redis sin redis": leemos la tabla cada intervalo y empujamos el snapshot.
// EventSource no permite headers, así que aceptamos el token por ?token= (o cookie).
export async function GET(req: NextRequest) {
  const token =
    req.nextUrl.searchParams.get('token') ||
    req.headers.get('authorization')?.replace(/^Bearer /, '') ||
    req.cookies.get('token')?.value ||
    ''
  if (!verifyToken(token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      async function snapshot() {
        const grouped = await prisma.syncJob.groupBy({
          by: ['status'],
          _count: { _all: true },
        })
        const counts: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0, skipped: 0 }
        for (const g of grouped) counts[g.status] = g._count._all
        const total = Object.values(counts).reduce((a, b) => a + b, 0)
        const recent = await prisma.syncJob.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 15,
          select: { externalId: true, folio: true, customerName: true, status: true, cost: true, error: true, updatedAt: true },
        })
        // Estado de configuración: el cálculo espera hasta que estén la fórmula y el punto de partida.
        const settings = await prisma.settings.findFirst()
        const branch = await prisma.branch.findFirst({ where: { originConfigured: true } })
        const ready = {
          formulaOk: !!settings?.domConfigured,
          originOk: !!branch,
          ok: !!settings?.domConfigured && !!branch,
        }
        return { counts, total, recent, ready, ts: Date.now() }
      }

      const pushSnapshot = async () => {
        if (closed) return
        try { send('sync', await snapshot()) } catch { /* transitorio; el próximo reintenta */ }
      }

      // primer snapshot inmediato
      await pushSnapshot()

      // keep-alive comment cada 20s (evita timeouts de proxies)
      const ka = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: keep-alive\n\n`))
      }, 20000)

      let poll: ReturnType<typeof setInterval> | null = null
      let debounce: ReturnType<typeof setTimeout> | null = null
      let onMsg: ((ch: string, msg: string) => void) | null = null

      if (redisEnabled()) {
        // Camino Redis: el worker (sync-queue.mjs) publica en procovar-delivery:sync:changed
        // cuando cambia un job; recalculamos el snapshot por EVENTO (cero polling por cliente).
        const sub = getSubscriber()!
        await sub.subscribe(CH_SYNC_CHANGED)
        onMsg = (ch: string) => {
          if (closed || ch !== CH_SYNC_CHANGED) return
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(pushSnapshot, 300) // agrupa ráfagas de cambios
        }
        sub.on('message', onMsg)
        // Red de seguridad LENTA (30s) por si se pierde algún evento; no 1.5s.
        poll = setInterval(pushSnapshot, 30000)
      } else {
        // Sin Redis: polling a la tabla cada 1.5s (comportamiento original).
        poll = setInterval(pushSnapshot, 1500)
      }

      const close = () => {
        if (closed) return
        closed = true
        if (poll) clearInterval(poll)
        clearInterval(ka)
        if (debounce) clearTimeout(debounce)
        if (onMsg) { try { getSubscriber()?.off('message', onMsg) } catch { /* noop */ } }
        try { controller.close() } catch { /* ya cerrado */ }
      }
      req.signal.addEventListener('abort', close)
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
