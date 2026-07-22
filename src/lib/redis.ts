// Cliente Redis OPCIONAL y Sentinel-ready para DELIVERY (mismo patrón que PEDIDO).
//
// Redis es OPCIONAL: sin REDIS_URL, delivery funciona igual (el SSE de la cola de
// sincronización cae a polling de la tabla SyncJob, comportamiento actual).
//   - REDIS_URL                              -> conexión simple.
//   - REDIS_SENTINELS + REDIS_MASTER_NAME    -> Sentinel (HA multi-nodo).
//
// Prefijo por app para NO colisionar en un Redis compartido con PEDIDO:
//   canales = procovar-delivery:*
import { Redis, type RedisOptions } from 'ioredis'

export const PREFIX = 'procovar-delivery'
export const CH_SYNC_CHANGED = `${PREFIX}:sync:changed`

const COMMON: RedisOptions = {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 3000),
}

function makeConnection(): Redis | null {
  const sentinels = (process.env.REDIS_SENTINELS || '').trim()
  const masterName = (process.env.REDIS_MASTER_NAME || '').trim()
  const url = (process.env.REDIS_URL || '').trim()

  if (sentinels && masterName) {
    const nodes = sentinels.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [host, port] = s.split(':')
      return { host, port: Number(port || 26379) }
    })
    return new Redis({ ...COMMON, sentinels: nodes, name: masterName })
  }
  if (url) return new Redis(url, COMMON)
  return null
}

// Singleton a nivel de módulo: Next reusa el módulo entre requests de la misma
// instancia, así que hay UNA conexión compartida (no una por request SSE).
const g = globalThis as unknown as { __procovarRedis?: Redis | null; __procovarRedisSub?: Redis | null }
const connection = g.__procovarRedis !== undefined ? g.__procovarRedis : (g.__procovarRedis = makeConnection())
const subscriber = g.__procovarRedisSub !== undefined
  ? g.__procovarRedisSub
  : (g.__procovarRedisSub = connection ? connection.duplicate() : null)

let loggedError = false
for (const c of [connection, subscriber]) {
  c?.on('error', (e: Error) => {
    if (!loggedError) { console.error(`[redis] ${e.message} (se reintenta en background)`); loggedError = true }
  })
  c?.on('ready', () => { loggedError = false })
}

export function redisEnabled(): boolean {
  return connection !== null
}

/** Conexión dedicada para SUSCRIBIRSE (o null si Redis está deshabilitado). */
export function getSubscriber(): Redis | null {
  return subscriber
}

/** Publica un evento JSON. No-op si Redis está deshabilitado. Nunca lanza. */
export async function publishJSON(channel: string, payload: unknown): Promise<void> {
  if (!connection) return
  try {
    await connection.publish(channel, JSON.stringify(payload))
  } catch (e) {
    console.error(`[redis] publish ${channel} falló:`, (e as Error).message)
  }
}
