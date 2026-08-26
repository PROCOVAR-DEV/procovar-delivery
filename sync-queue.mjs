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
const POLL = arg('poll') ? parseInt(arg('poll'), 10) : 300000;   // 5 min

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

/**
 * Los pedidos RECIENTES, no los pendientes ni todos.
 *
 * Antes pedía `onlyPending=1` porque delivery era quien cotizaba: le interesaban los que
 * aún no tenían precio. Ahora el precio lo pone delivery-apk, y con ese filtro delivery
 * se perdería justo los ya cotizados —la mayoría, y los que hacen falta para armar una
 * ruta—.
 *
 * Pero quitar el filtro y ya fue un error mío que tiró el proceso: son ~55.000 pedidos,
 * y traerlos enteros para mandarlos en UNA llamada agotó la memoria de Node. Lo que hace
 * falta aquí son los de los últimos días: una ruta se arma con lo que hay que repartir
 * ahora, no con el histórico de dos años.
 */
const DIAS = Number(process.env.SYNC_DIAS || 15);

async function traerPedidos() {
  const desde = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ desde });
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
  /**
   * Por lotes, y no todo de una vez.
   *
   * El reparto de carga se calcula por envío, así que idealmente iría junto; pero
   * mandar miles de pedidos en un solo POST es lo que reventó la memoria. Un lote de
   * 200 es un tamaño realista de camión y mantiene el cálculo con sentido.
   */
  const LOTE = 200;
  let guardados = 0;

  for (let i = 0; i < orders.length; i += LOTE) {
    const trozo = orders.slice(i, i + LOTE);

    try {
      const { byRef } = await quoteBatch(trozo);

      guardados += byRef.size;
    } catch (e) {
      log(`lote ${i / LOTE + 1} falló: ${e.message}`);
    }
    await sleep(200);   // sin esto, veinte lotes seguidos ahogan a delivery
  }
  log(`${orders.length} pedidos de los últimos ${DIAS} días (${guardados} con reparto)`);
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

  // Se quitó el modo event-driven: escuchaba la cola procovar-delivery:in:orders y
  // PEDIDO ya no publica ahí. Un proceso esperando avisos que nunca llegan no da error
  // —simplemente no hace nada—, y eso es peor que no tenerlo: parece que funciona.
  //
  // Un repaso cada POLL ms. Es un espejo para planificar rutas a mano: nadie necesita
  // que un pedido aparezca aquí en menos de unos minutos.
  for (;;) {
    try { await cycle(); } catch (e) { log('ciclo FALLÓ:', e.message); }
    await sleep(POLL);
  }
}

main()
  .catch((e) => { log('FATAL:', e.message); process.exitCode = 1; })
  .finally(async () => { if (ONCE || RECOMPUTE) await prisma.$disconnect(); });
