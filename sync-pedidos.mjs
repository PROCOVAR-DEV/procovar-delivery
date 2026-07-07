// Worker de delivery: JALA los pedidos de la API de PEDIDO, los cotiza con
// /api/quote/batch (que calcula el domicilio y resuelve el peso vía warehouse) y
// ESCRIBE DE VUELTA el costo en PEDIDO (Pedido.costoDomicilio). Modelo pull.
//
// Comunicación 100% por HTTP (PEDIDO y delivery tienen su API). Local o remoto.
//
// Env (de procovar-delivery/.env):
//   PEDIDO_API_URL    default http://localhost:4000
//   DELIVERY_URL      default http://localhost:3002   (esta misma app)
//   SERVICE_API_KEY   la MISMA en PEDIDO y en delivery (x-api-key)
//
// Uso:
//   node sync-pedidos.mjs [--all] [--limit 200] [--chunk 200] [--dry]
//     --all    procesa todos (no solo los pendientes sin costo)
//     --dry    calcula pero NO escribe de vuelta en PEDIDO

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carga simple del .env (delivery no depende de dotenv en scripts).
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
  } catch { /* sin .env: se usan defaults / env del proceso */ }
}
loadEnv();

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const ALL = !!arg('all', false);
const DRY = !!arg('dry', false);
const LIMIT = arg('limit') ? parseInt(arg('limit'), 10) : undefined;
const CHUNK = arg('chunk') ? parseInt(arg('chunk'), 10) : 200;

const PEDIDO_API_URL = process.env.PEDIDO_API_URL || 'http://localhost:4000';
const DELIVERY_URL = process.env.DELIVERY_URL || 'http://localhost:3002';
const KEY = process.env.SERVICE_API_KEY;
// Código de la sucursal de este delivery (= Branch.externalId). Si se define,
// PEDIDO valida que solo se jalen/escriban pedidos de esta sucursal.
const SUCURSAL_CODIGO = process.env.SUCURSAL_CODIGO || '';

async function main() {
  if (!KEY) throw new Error('Falta SERVICE_API_KEY (la misma en PEDIDO y delivery).');

  // 1) JALAR pedidos de PEDIDO
  const q = new URLSearchParams();
  if (!ALL) q.set('onlyPending', '1');
  if (LIMIT) q.set('limit', String(LIMIT));
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  const pull = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, {
    headers: { 'x-api-key': KEY },
  });
  if (!pull.ok) throw new Error(`PEDIDO ${pull.status}: ${await pull.text().catch(() => '')}`);
  const { count, orders: pedidos } = await pull.json();
  console.log(`PEDIDO devolvió ${count} pedidos ${ALL ? '(todos)' : '(pendientes con geo)'}.`);
  if (!count) return;

  const tot = { quoted: 0, persisted: 0, skipped: 0, written: 0 };
  let weightsSource = 'none';

  for (let i = 0; i < pedidos.length; i += CHUNK) {
    const chunk = pedidos.slice(i, i + CHUNK);

    // 2) COTIZAR en delivery
    const batchOrders = chunk.map((p) => ({
      sucursalExternalId: p.sucursalCodigo,
      customerName: p.cliente?.nombre || p.encargado || 'Cliente',
      address: p.direccion || p.cliente?.direccion || null,
      phone: p.telefono || null,
      lat: p.cliente?.latitud ?? null,
      lng: p.cliente?.longitud ?? null,
      // items completos (code = SKU para resolver el peso vía warehouse)
      items: (p.items || []).map((it) => ({
        code: it.codigo,
        name: it.producto,
        quantity: it.unidades || 1,
        packs: it.packs,
        descripcion: it.descripcion,
      })),
      operationNumber: p.folio,
      externalId: p.id,
      // meta = pedido + cliente COMPLETOS, para que delivery lo guarde íntegro.
      meta: p,
    }));
    const bres = await fetch(`${DELIVERY_URL}/api/quote/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ orders: batchOrders }),
    });
    if (!bres.ok) { console.error(`  batch ${bres.status}: ${await bres.text().catch(() => '')}`); continue; }
    const bj = await bres.json();
    weightsSource = bj.weightsSource || weightsSource;
    tot.quoted += bj.quoted || 0; tot.persisted += bj.persisted || 0; tot.skipped += bj.skipped || 0;

    // 3) ESCRIBIR DE VUELTA el costo en PEDIDO
    const updates = (bj.results || [])
      .filter((r) => r.status === 'quoted' && r.ref && r.price != null)
      .map((r) => ({ id: r.ref, costo: r.price, distanceKm: r.distanceKm }));

    if (!DRY && updates.length) {
      const wres = await fetch(`${PEDIDO_API_URL}/integration/orders/domicilio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ updates }),
      });
      if (wres.ok) { const wj = await wres.json(); tot.written += wj.updated || 0; }
      else console.error(`  writeback ${wres.status}: ${await wres.text().catch(() => '')}`);
    }
    console.log(`  lote ${Math.floor(i / CHUNK) + 1}: quoted ${bj.quoted} · skipped ${bj.skipped} · a escribir ${updates.length}${DRY ? ' (dry)' : ''}`);
  }

  console.log('\n===== TOTAL =====');
  console.log(`quoted ${tot.quoted} · persisted(delivery) ${tot.persisted} · skipped ${tot.skipped} · costo escrito en PEDIDO ${tot.written} · pesos: ${weightsSource}`);
}

main().catch((e) => { console.error('FALLÓ:', e.message); process.exitCode = 1; });
