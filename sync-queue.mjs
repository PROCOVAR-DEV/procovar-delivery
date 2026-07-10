// Worker de COLA de delivery (reemplaza el sync bulk por procesamiento suave).
//
// Modelo "redis sin redis": la tabla SyncJob (Postgres) es el bus.
//   1) ENCOLAR: cada ciclo pregunta a PEDIDO por pedidos pendientes con geo y
//      crea un SyncJob(pending) por cada uno que no esté ya encolado (idempotente
//      por externalId = id del pedido en PEDIDO).
//   2) PROCESAR: toma los pending de a UNO, con un delay entre cada uno (suave,
//      no en bulk), lo cotiza en delivery (/api/quote/batch con 1 orden, que
//      resuelve el peso vía warehouse) y ESCRIBE el costo de vuelta en PEDIDO.
//   3) El endpoint SSE (/api/sync/stream) lee SyncJob y transmite el estado en vivo.
//
// Corre como proceso PM2 (procovar-delivery-sync). Env desde procovar-delivery/.env.
//
// Uso:  node sync-queue.mjs [--once] [--delay 1500] [--poll 15000]
//   --once   un solo ciclo (encolar + vaciar la cola) y salir. Sin esto, corre en bucle.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

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
const DELAY = arg('delay') ? parseInt(arg('delay'), 10) : 1500;      // pausa entre pedidos (suave)
const POLL = arg('poll') ? parseInt(arg('poll'), 10) : 15000;        // cada cuánto busca pedidos nuevos
const MAX_ATTEMPTS = 3;

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:8400';
const DELIVERY_URL = process.env.DELIVERY_URL || 'http://localhost:3002';
const KEY = process.env.SERVICE_API_KEY;
const SUCURSAL_CODIGO = process.env.SUCURSAL_CODIGO || '';

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Descarga los pedidos pendientes de PEDIDO UNA vez (por ciclo).
async function fetchPending() {
  const q = new URLSearchParams({ onlyPending: '1' });
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`PEDIDO ${res.status}: ${await res.text().catch(() => '')}`);
  const { orders = [] } = await res.json();
  return orders;
}

// 1) ENCOLAR: por cada pendiente crea SyncJob(pending) si no existe (idempotente).
async function enqueueNew(orders) {
  let nuevos = 0;
  for (const p of orders) {
    try {
      await prisma.syncJob.create({
        data: { externalId: p.id, folio: p.folio, customerName: p.cliente?.nombre || p.encargado || null },
      });
      nuevos++;
    } catch (e) {
      // unique externalId -> ya estaba encolado; ignorar
      if (!String(e.message).includes('Unique') && e.code !== 'P2002') throw e;
    }
  }
  return nuevos;
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

// Escribe el costo de vuelta en PEDIDO para un pedido.
async function writeback(externalId, cost, distanceKm) {
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders/domicilio`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ updates: [{ id: externalId, costo: cost, distanceKm }] }),
  });
  if (!res.ok) throw new Error(`writeback ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// 2) ESCRIBIR de vuelta los costos, de a uno con delay (suave) para el SSE. El precio
// ya viene cotizado en el LOTE (`resultsByRef`), aquí solo se escribe en PEDIDO.
async function drainQueue(byId, resultsByRef, weightsSource) {
  let procesados = 0;
  // Pedidos de sucursales aún sin configurar: se saltan SOLO en este ciclo (para no
  // reprocesarlos en bucle) pero quedan 'pending' y se reintentan en el próximo.
  const enEspera = [];
  for (;;) {
    const job = await prisma.syncJob.findFirst({
      where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS }, id: { notIn: enEspera } },
      orderBy: { createdAt: 'asc' },
    });
    if (!job) break;

    await prisma.syncJob.update({ where: { id: job.id }, data: { status: 'processing', attempts: { increment: 1 } } });
    try {
      const pedido = byId.get(job.externalId);
      if (!pedido) {
        // ya no está pendiente (quizá ya tiene costo) -> lo marcamos done sin costo
        await prisma.syncJob.update({ where: { id: job.id }, data: { status: 'skipped', processedAt: new Date(), error: 'ya no pendiente' } });
        continue;
      }
      const r = resultsByRef.get(job.externalId) || { status: 'skipped', reason: 'sin-resultado' };
      if (r.status === 'quoted' && r.price != null) {
        await writeback(job.externalId, r.price, r.distanceKm);
        await prisma.syncJob.update({
          where: { id: job.id },
          data: { status: 'done', cost: r.price, distanceKm: r.distanceKm, weightsSource, processedAt: new Date(), error: null },
        });
        log(`✓ ${job.folio || job.externalId} -> $${Number(r.price).toFixed(2)} (${weightsSource})`);
        procesados++;
      } else if (ESPERA.has(r.reason)) {
        // La sucursal de este pedido aún no tiene almacén/punto de partida configurado:
        // se deja EN ESPERA (pending, sin gastar el intento). Las DEMÁS sucursales que
        // sí estén listas se siguen procesando en este mismo ciclo.
        await prisma.syncJob.update({ where: { id: job.id }, data: { status: 'pending', attempts: { decrement: 1 }, error: `esperando: ${r.reason}` } });
        enEspera.push(job.id);
        log(`… ${job.folio || job.externalId} en espera (${r.reason})`);
        continue; // no dormir: pasa al siguiente pedido
      } else {
        await prisma.syncJob.update({ where: { id: job.id }, data: { status: 'skipped', weightsSource, processedAt: new Date(), error: r.reason || r.status || 'sin cotizar' } });
        log(`- ${job.folio || job.externalId} skipped (${r.reason || r.status})`);
      }
    } catch (e) {
      const failed = job.attempts + 1 >= MAX_ATTEMPTS;
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: failed ? 'error' : 'pending', error: String(e.message).slice(0, 300) },
      });
      log(`✗ ${job.folio || job.externalId} ${failed ? 'ERROR' : 'reintento'}: ${e.message}`);
    }
    await sleep(DELAY); // suave, despacio
  }
  return procesados;
}

// La FÓRMULA (settings.domConfigured) es GLOBAL: sin ella no se calcula nada, en
// ninguna sucursal. El PUNTO DE PARTIDA ya NO se chequea aquí: es por-sucursal y lo
// valida la cotización (cada pedido usa el almacén de SU sucursal; si esa sucursal no
// tiene punto de partida, ese pedido queda en espera, sin frenar a las demás).
async function checkFormula() {
  const settings = await prisma.settings.findFirst();
  return !!settings?.domConfigured;
}

async function cycle() {
  if (!KEY) throw new Error('Falta SERVICE_API_KEY.');
  const orders = await fetchPending();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const nuevos = await enqueueNew(orders);
  if (nuevos) log(`encolados ${nuevos} nuevos (de ${orders.length} pendientes)`);

  // GUARD GLOBAL: sin fórmula, la cola entera espera.
  if (!(await checkFormula())) {
    log('esperando configuración -> falta la FÓRMULA del domicilio (Ajustes). La cola queda en espera.');
    return;
  }

  // Cotiza TODO el lote de una vez (el precio de cada pedido depende del peso de carga
  // total del envío). Luego se escriben los costos de a uno (suave) para el SSE.
  const { byRef, weightsSource } = await quoteBatch(orders);
  const done = await drainQueue(byId, byRef, weightsSource);
  if (done) log(`procesados ${done} en este ciclo`);
}

// RECOMPUTE: recotiza TODOS los pedidos (con la fórmula vigente) y reescribe el costo en
// PEDIDO, aunque ya tuvieran costo. Úsalo tras cambiar la fórmula/tarifa/vehículo.
async function recomputeAll() {
  const q = new URLSearchParams(); // sin onlyPending => todos los que tienen geolocalización
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`PEDIDO ${res.status}: ${await res.text().catch(() => '')}`);
  const { orders = [] } = await res.json();
  log(`recompute: ${orders.length} pedidos con geo`);
  const { byRef } = await quoteBatch(orders); // recotiza + persiste los Order de delivery
  const updates = [];
  for (const o of orders) {
    const r = byRef.get(o.id);
    if (r && r.status === 'quoted' && r.price != null) updates.push({ id: o.id, costo: r.price, distanceKm: r.distanceKm });
  }
  log(`recompute: ${updates.length} recosteados, escribiendo en PEDIDO...`);
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    const wb = await fetch(`${PEDIDO_API_URL}/integration/orders/domicilio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ updates: chunk }),
    });
    if (!wb.ok) throw new Error(`writeback ${wb.status}: ${await wb.text().catch(() => '')}`);
  }
  log(`recompute LISTO: ${updates.length} domicilios actualizados.`);
}

async function main() {
  log(`sync-queue arrancado. PEDIDO=${PEDIDO_API_URL} delay=${DELAY}ms poll=${POLL}ms once=${ONCE}`);
  if (RECOMPUTE) { await recomputeAll(); return; }
  // Recupera jobs que quedaron 'processing' si el worker murió a mitad.
  const reset = await prisma.syncJob.updateMany({ where: { status: 'processing' }, data: { status: 'pending' } });
  if (reset.count) log(`recuperados ${reset.count} jobs 'processing' huérfanos -> pending`);
  if (ONCE) { await cycle(); return; }
  for (;;) {
    try { await cycle(); } catch (e) { log('ciclo FALLÓ:', e.message); }
    await sleep(POLL);
  }
}

main()
  .catch((e) => { log('FATAL:', e.message); process.exitCode = 1; })
  .finally(async () => { if (ONCE || RECOMPUTE) await prisma.$disconnect(); });
