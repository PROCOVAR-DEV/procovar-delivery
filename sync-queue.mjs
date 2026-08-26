// Espejo de PEDIDO en delivery: trae los pedidos y los clientes, y nada más.
//
// Antes esto era una COLA (tabla SyncJob) que procesaba los pedidos de uno en uno con
// una pausa entre cada uno. Esa lentitud era a propósito: alimentaba una pantalla de
// sincronización que enseñaba el progreso en vivo. Quitada la pantalla, la cola no
// servía a nadie — sólo hacía que traerse 600 pedidos tardara quince minutos en vez de
// unos segundos.
//
// Lo que queda es lo único que hacía falta: pedirle a PEDIDO sus pedidos y sus clientes,
// y guardarlos aquí para poder planificar las rutas a mano.
//
// El costo del domicilio NO se toca. Lo pone delivery-apk directamente en PEDIDO. Lo que
// se calcula aquí es el reparto de carga del camión, y se queda aquí.
//
// Uso:  node sync-queue.mjs [--once] [--poll 15000] [--recompute]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import Queue from 'bull';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const k = m[1];
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* sin .env */ }
}
loadEnv();

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const ONCE = !!arg('once', false);
const RECOMPUTE = !!arg('recompute', false); // recotiza TODOS (no solo pendientes) y reescribe el costo
const POLL = arg('poll') ? parseInt(arg('poll'), 10) : 15000;        // cada cuánto busca pedidos nuevos

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:8400';
const DELIVERY_URL = process.env.DELIVERY_URL || 'http://localhost:3002';
const KEY = process.env.SERVICE_API_KEY;
const SUCURSAL_CODIGO = process.env.SUCURSAL_CODIGO || '';

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

let _redisPub = null;
(function initRedis() {
  const sentinels = (process.env.REDIS_SENTINELS || '').trim();
  const master = (process.env.REDIS_MASTER_NAME || '').trim();
  const url = (process.env.REDIS_URL || '').trim();
  const opts = { maxRetriesPerRequest: null, retryStrategy: (t) => Math.min(t * 200, 3000) };
  if (sentinels && master) {
    const nodes = sentinels.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [host, port] = s.split(':');
      return { host, port: Number(port || 26379) };
    });
    _redisPub = new IORedis({ ...opts, sentinels: nodes, name: master });
  } else if (url) {
    _redisPub = new IORedis(url, opts);
  }
  if (_redisPub) _redisPub.on('error', () => { /* se reintenta en background */ });
})();

// Event-driven (slice 2): en vez de sondear PEDIDO cada 15s, consumimos la cola DURABLE
// procovar-delivery:in:orders que PEDIDO llena al crear/importar/geolocalizar un pedido.
// Gated por DELIVERY_EVENTS: true = event-driven (sin poll), false = poll actual (fallback).
const DELIVERY_EVENTS = process.env.DELIVERY_EVENTS === 'true';
const QUEUE_IN_ORDERS = 'procovar-delivery:in:orders';

function makeInOrdersQueue() {
  const url = (process.env.REDIS_URL || '').trim();
  const sentinels = (process.env.REDIS_SENTINELS || '').trim();
  const master = (process.env.REDIS_MASTER_NAME || '').trim();
  if (!url && !(sentinels && master)) return null;
  const opts = { enableReadyCheck: false, maxRetriesPerRequest: null };
  const mk = () => {
    if (sentinels && master) {
      const nodes = sentinels.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [h, p] = s.split(':');
        return { host: h, port: Number(p || 26379) };
      });
      return new IORedis({ ...opts, sentinels: nodes, name: master });
    }
    return new IORedis(url, opts);
  };
  return new Queue(QUEUE_IN_ORDERS, { createClient: () => mk() });
}

// Descarga los pedidos pendientes de PEDIDO UNA vez (por ciclo).
/**
 * TODOS los pedidos, no sólo los que están sin costo.
 *
 * Antes pedía `onlyPending=1` porque delivery era quien los cotizaba: le interesaban los
 * que aún no tenían precio. Ahora el precio lo pone delivery-apk, y con ese filtro
 * delivery se perdería justo los pedidos que la APK ya cotizó — que son la mayoría, y
 * los que hacen falta para armar una ruta.
 */
async function traerPedidos() {
  const q = new URLSearchParams();
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`PEDIDO ${res.status}: ${await res.text().catch(() => '')}`);
  const { orders = [] } = await res.json();
  return orders;
}


// Cotiza TODO el lote en UNA sola llamada. Es imprescindible: el precio de cada pedido
// es su FRACCIÓN DE PESO del costo de transporte, así que depende del PESO DE CARGA total
// del envío (suma del peso de todos los pedidos). Si se cotizara de a uno, la carga sería
// el peso de ese pedido y el precio saldría mal. Devuelve un Map externalId(=id) -> result.
async function quoteBatch(pedidos) {
  if (!pedidos.length) return { byRef: new Map(), weightsSource: 'none' };
  const body = {
    orders: pedidos.map((pedido) => ({
      sucursalExternalId: pedido.sucursalCodigo,
      customerName: pedido.cliente?.nombre || pedido.encargado || 'Cliente',
      address: pedido.direccion || pedido.cliente?.direccion || null,
      phone: pedido.telefono || null,
      lat: pedido.cliente?.latitud ?? null,
      lng: pedido.cliente?.longitud ?? null,
      items: (pedido.items || []).map((it) => ({
        code: it.codigo, name: it.producto, quantity: it.unidades || 1, packs: it.packs, descripcion: it.descripcion,
      })),
      operationNumber: pedido.folio,
      externalId: pedido.id,
      // SOLO los marcados requiere_domicilio=true llevan costo. Los false (y los que no
      // traen el dato) se importan igual —hacen falta para las rutas y la capacidad del
      // camión— pero SIN precio de domicilio.
      requiereDomicilio: pedido.requiereDomicilio === true,
      meta: pedido,
    })),
  };
  const res = await fetch(`${DELIVERY_URL}/api/quote/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`quote ${res.status}: ${await res.text().catch(() => '')}`);
  const j = await res.json();
  const byRef = new Map();
  for (const r of (j.results || [])) if (r.ref != null) byRef.set(r.ref, r);
  return { byRef, weightsSource: j.weightsSource };
}

// Skips que significan "la sucursal aún no está lista" (no es un fallo del pedido):
// se dejan EN ESPERA para reintentar cuando se configure esa sucursal.
const ESPERA = new Set(['sucursal-no-mapeada', 'sucursal-sin-punto-de-partida', 'sucursal-sin-vehiculo-de-calculo']);


/**
 * Delivery NO le escribe nada a PEDIDO. Nunca más.
 *
 * El costo del domicilio lo pone la APK, que se lo manda a PEDIDO por su webhook. Esto
 * está BORRADO y no detrás de un interruptor a propósito: mientras existiera la forma de
 * reactivarlo, existía la forma de que dos sistemas escribieran el mismo campo y que el
 * último en pasar pisara al otro sin que nadie se enterara.
 *
 * Lo que sigue haciendo este proceso es traerse los pedidos para que delivery pueda
 * planificar sus rutas a mano. El precio que calcula es SUYO, para repartir la carga
 * del camión, y se queda en su base de datos.
 */


// La FÓRMULA (settings.domConfigured) es GLOBAL: sin ella no se calcula nada, en
// ninguna sucursal. El PUNTO DE PARTIDA ya NO se chequea aquí: es por-sucursal y lo
// valida la cotización (cada pedido usa el almacén de SU sucursal; si esa sucursal no
// tiene punto de partida, ese pedido queda en espera, sin frenar a las demás).
async function checkFormula() {
  const settings = await prisma.settings.findFirst();
  return !!settings?.domConfigured;
}

// Espeja los clientes GEOLOCALIZADOS de PEDIDO en la tabla Customer local (mirror).
// AUTOMÁTICO (cada ciclo), no manual: un cliente nuevo con geo en PEDIDO aparece aquí
// solo. Upsert por externalId + borra los que ya no vienen (borrados o sin geo). Si la
// API falla, LANZA antes de borrar nada (no vaciar el mirror ante un error transitorio).
// Cuántos clientes se piden por página. Traerlos todos de golpe eran 2.17 MB
// en una sola respuesta; por páginas la memoria se mantiene plana y una
// respuesta cortada a medias no deja el proceso con datos incompletos.
const PAGINA_CLIENTES = 1000;

async function traerClientesPaginado() {
  const clients = [];
  let cursor = null;
  for (;;) {
    const q = new URLSearchParams();
    if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
    q.set('limit', String(PAGINA_CLIENTES));
    if (cursor) q.set('cursor', cursor);

    const res = await fetch(`${PEDIDO_API_URL}/integration/clients?${q}`, { headers: { 'x-api-key': KEY } });
    if (!res.ok) throw new Error(`clients ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    clients.push(...(data.clients || []));

    // Si el api es anterior a la paginación no manda nextCursor y devuelve
    // todo de una: se corta el bucle y funciona igual.
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return clients;
}

async function syncCustomers() {
  // El recorrido se completa ANTES de tocar nada: el borrado de abajo usa la
  // lista entera de ids. Si fallara a mitad, la excepción sube y no se borra
  // nada — vaciar el espejo por una página perdida sería el peor final posible.
  const clients = await traerClientesPaginado();

  const ids = [];
  let up = 0;
  for (const c of clients) {
    if (c.latitud == null || c.longitud == null) continue; // defensa: solo con geo
    ids.push(c.id);
    const data = {
      source: 'pedido',
      externalId: c.id,
      name: c.nombre,
      phone: c.telefono ?? null,
      address: c.direccion ?? null,
      municipio: c.municipio ?? null,
      zona: c.zona ?? null,
      lat: c.latitud,
      lng: c.longitud,
      sucursalCodigo: c.sucursalCodigo ?? null,
      meta: c, // payload COMPLETO del cliente (igual que Order.meta)
    };
    // Idempotente por [source, externalId] — MISMO patrón que las orders.
    const existing = await prisma.customer.findFirst({ where: { source: 'pedido', externalId: c.id } });
    if (existing) {
      await prisma.customer.update({ where: { id: existing.id }, data: { ...data, syncedAt: new Date() } });
    } else {
      await prisma.customer.create({ data });
    }
    up++;
  }
  // Quitar SOLO los de source='pedido' que ya no vienen (borrados o sin geo). NO toca los
  // clientes manuales (source=null). Con ids vacío, notIn:['__none__'] borra todos los de
  // pedido (0 con geo -> mirror de pedido vacío, correcto).
  const del = await prisma.customer.deleteMany({
    where: { source: 'pedido', externalId: { notIn: ids.length ? ids : ['__none__'] } },
  });
  return { up, del: del.count };
}

async function cycle() {
  if (!KEY) throw new Error('Falta SERVICE_API_KEY.');

  // Sincroniza el mirror de clientes SIEMPRE (independiente de la fórmula/cotización).
  // Aislado en su try: si falla, no rompe el procesamiento de domicilios.
  try {
    const r = await syncCustomers();
    if (r.up || r.del) log(`clientes mirror: ${r.up} sincronizados, ${r.del} quitados`);
  } catch (e) {
    log('sync de clientes falló:', e.message);
  }
  const orders = await traerPedidos();

  // GUARD GLOBAL: sin fórmula, la cola entera espera.
  if (!(await checkFormula())) {
    log('esperando configuración -> falta la FÓRMULA del domicilio (Ajustes). La cola queda en espera.');
    return;
  }

  // El lote entero de una vez. Además de calcular, ESTA llamada es la que guarda los
  // pedidos en delivery: quoteBatch hace el upsert de cada Order por su externalId.
  //
  // Y va en un solo envío porque el precio de cada pedido es su fracción de peso del
  // costo del camión: cotizarlos de uno en uno daría un reparto distinto y mal.
  const { byRef } = await quoteBatch(orders);
  log(`${orders.length} pedidos al día (${byRef.size} con reparto de carga)`);
}

// RECOMPUTE: recotiza TODOS los pedidos con la fórmula vigente y refresca los Order de
// delivery. Úsalo tras cambiar la fórmula, la tarifa o el vehículo de cálculo.
//
// Ya NO escribe nada en PEDIDO: el costo que ve el cliente lo pone la APK. Lo que se
// recalcula aquí es el reparto de carga para las rutas de delivery, y se queda aquí.
async function recomputeAll() {
  const q = new URLSearchParams(); // sin onlyPending => todos los que tienen geolocalización
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`PEDIDO ${res.status}: ${await res.text().catch(() => '')}`);
  const { orders = [] } = await res.json();
  log(`recompute: ${orders.length} pedidos con geo`);
  const { byRef } = await quoteBatch(orders); // recotiza + persiste los Order de delivery
  let n = 0;
  for (const o of orders) {
    const r = byRef.get(o.id);
    if (r && r.status === 'quoted' && r.price != null) n++;
  }
  log(`recompute LISTO: ${n} pedidos recosteados en delivery (PEDIDO no se toca).`);
}

async function main() {
  log(`espejo arrancado. PEDIDO=${PEDIDO_API_URL} poll=${POLL}ms once=${ONCE}`);
  if (RECOMPUTE) { await recomputeAll(); return; }
  if (ONCE) { await cycle(); return; }

  if (DELIVERY_EVENTS) {
    // EVENT-DRIVEN: sin poll. PEDIDO encola en procovar-delivery:in:orders al crear/
    // importar/geolocalizar; cada job dispara un ciclo. Bull serializa (concurrency 1),
    // así que ciclos redundantes son baratos (el segundo no encuentra pendientes).
    const q = makeInOrdersQueue();
    if (!q) { log('DELIVERY_EVENTS=true pero sin REDIS_URL/Sentinel. Saliendo.'); process.exit(1); }
    q.on('error', (e) => log('cola in:orders error:', e.message));
    q.process(1, async () => {
      try { await cycle(); } catch (e) { log('ciclo FALLÓ:', e.message); }
    });
    log(`event-driven: escuchando ${QUEUE_IN_ORDERS} (SIN poll de 15s)`);
    await cycle(); // procesa lo que hubiera pendiente al arrancar

    // Red de seguridad LENTA (default 5 min; SAFETY_POLL_MS=0 la apaga). NO es polling
    // cada 5s: reconcilia por si se perdió un evento o cambió la config en delivery
    // (fórmula/almacén) — eso no dispara evento de PEDIDO, así que sin esto los pendientes
    // no se reprocesarían hasta el próximo pedido.
    const safetyMs = process.env.SAFETY_POLL_MS != null ? Number(process.env.SAFETY_POLL_MS) : 300000;
    if (safetyMs > 0) {
      for (;;) {
        await sleep(safetyMs);
        try { await cycle(); } catch (e) { log('safety cycle FALLÓ:', e.message); }
      }
    }
    return; // (si safety apagado) el proceso queda vivo consumiendo la cola
  }

  // FALLBACK (DELIVERY_EVENTS != true): poll cada POLL ms (comportamiento actual).
  for (;;) {
    try { await cycle(); } catch (e) { log('ciclo FALLÓ:', e.message); }
    await sleep(POLL);
  }
}

main()
  .catch((e) => { log('FATAL:', e.message); process.exitCode = 1; })
  .finally(async () => { if (ONCE || RECOMPUTE) await prisma.$disconnect(); });
