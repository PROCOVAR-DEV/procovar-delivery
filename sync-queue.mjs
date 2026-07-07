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

// Cotiza UN pedido en delivery y devuelve { price, distanceKm, weightsSource, status }.
async function quoteOne(pedido) {
  const body = {
    orders: [{
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
    }],
  };
  const res = await fetch(`${DELIVERY_URL}/api/quote/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`quote ${res.status}: ${await res.text().catch(() => '')}`);
  const j = await res.json();
  const r = (j.results || [])[0] || {};
  return { status: r.status, price: r.price, distanceKm: r.distanceKm, weightsSource: j.weightsSource };
}

// Escribe el costo de vuelta en PEDIDO para un pedido.
async function writeback(externalId, cost, distanceKm) {
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders/domicilio`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ updates: [{ id: externalId, costo: cost, distanceKm }] }),
  });
  if (!res.ok) throw new Error(`writeback ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// 2) PROCESAR la cola de a uno, con delay (suave). `byId` = snapshot del ciclo.
async function drainQueue(byId) {
  let procesados = 0;
  for (;;) {
    const job = await prisma.syncJob.findFirst({
      where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS } },
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
      const r = await quoteOne(pedido);
      if (r.status === 'quoted' && r.price != null) {
        await writeback(job.externalId, r.price, r.distanceKm);
        await prisma.syncJob.update({
          where: { id: job.id },
          data: { status: 'done', cost: r.price, distanceKm: r.distanceKm, weightsSource: r.weightsSource, processedAt: new Date(), error: null },
        });
        log(`✓ ${job.folio || job.externalId} -> $${r.price} (${r.weightsSource})`);
        procesados++;
      } else {
        await prisma.syncJob.update({ where: { id: job.id }, data: { status: 'skipped', weightsSource: r.weightsSource, processedAt: new Date(), error: r.status || 'sin cotizar' } });
        log(`- ${job.folio || job.externalId} skipped (${r.status})`);
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

// ¿Está lista la configuración? El cálculo NO corre hasta que estén seteados
// la FÓRMULA (settings.domConfigured) y el PUNTO DE PARTIDA (branch.originConfigured).
async function checkReady() {
  const settings = await prisma.settings.findFirst();
  const formulaOk = !!settings?.domConfigured;
  const branch = SUCURSAL_CODIGO
    ? await prisma.branch.findFirst({ where: { externalId: SUCURSAL_CODIGO } })
    : await prisma.branch.findFirst();
  const originOk = !!branch?.originConfigured;
  return { ok: formulaOk && originOk, formulaOk, originOk };
}

async function cycle() {
  if (!KEY) throw new Error('Falta SERVICE_API_KEY.');
  const orders = await fetchPending();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const nuevos = await enqueueNew(orders);
  if (nuevos) log(`encolados ${nuevos} nuevos (de ${orders.length} pendientes)`);

  // GUARD: sin fórmula o sin punto de partida, la cola ESPERA (no calcula).
  const ready = await checkReady();
  if (!ready.ok) {
    log(`esperando configuración -> fórmula: ${ready.formulaOk ? 'OK' : 'FALTA'}, punto de partida: ${ready.originOk ? 'OK' : 'FALTA'}. La cola queda en espera.`);
    return;
  }

  const done = await drainQueue(byId);
  if (done) log(`procesados ${done} en este ciclo`);
}

async function main() {
  log(`sync-queue arrancado. PEDIDO=${PEDIDO_API_URL} delay=${DELAY}ms poll=${POLL}ms once=${ONCE}`);
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
  .finally(async () => { if (ONCE) await prisma.$disconnect(); });
