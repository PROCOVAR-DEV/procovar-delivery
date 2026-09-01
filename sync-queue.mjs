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
// El costo del domicilio NO se toca. Lo pone Entrega directamente en PEDIDO. Lo que
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
/**
 * Cada minuto, no cada cinco.
 *
 * El costo del domicilio lo pone el repartidor desde Entrega y hasta que el espejo no
 * pasa, aquí sigue diciendo «sin cotizar». Cinco minutos mirando una pantalla que no
 * cambia se leen como que está roto. El ciclo es barato —lo incremental casi siempre
 * trae cero filas—, y lo caro (el barrido del histórico) tiene su propio freno abajo.
 */
const POLL = arg('poll') ? parseInt(arg('poll'), 10) : 60000;   // 1 min

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
 * TODOS los pedidos, no un recorte de los últimos días.
 *
 * Aquí ha habido dos errores seguidos, opuestos y los dos malos.
 *
 * El primero: pedir `onlyPending=1`, de cuando delivery era quien cotizaba. Con el precio
 * puesto por la APK, ese filtro se lleva justo los pedidos ya cotizados —la mayoría, y los
 * que hacen falta para armar una ruta—.
 *
 * El segundo, mío: quitar el filtro y traerlo todo en UNA llamada. Son 56.000 pedidos con
 * sus líneas, y montar ese JSON agotó la memoria de Node. De ahí salió el recorte a
 * quince días... que dejó fuera el catálogo entero. Una ruta se arma también con pedidos
 * ya completados, y la mitad del trabajo es mirar lo de la semana pasada.
 *
 * Lo que arregla las dos cosas no es elegir cuántos días, es no traerlos dos veces:
 *
 *   - La PRIMERA vez se recorre el histórico por tramos de días, de lo nuevo a lo viejo.
 *     Tarda, y pasa una sola vez.
 *   - A partir de ahí se pide `since=<lo más nuevo que ya tengo>`: lo que se movió desde
 *     entonces. Suele ser nada o cuatro filas.
 *
 * La marca de agua sale de los propios datos —`max(pedidoUpdatedAt)` de lo guardado— y no
 * de un contador aparte. Un contador se adelanta si una tanda falla a medias, y entonces
 * el espejo se salta pedidos para siempre sin dar ningún error.
 */

/** Cuántos días por petición al recorrer el histórico. */
const TRAMO_DIAS = Number(process.env.SYNC_TRAMO_DIAS || 3);

/** Hasta dónde atrás llega el histórico. */
const HISTORICO_DIAS = Number(process.env.SYNC_HISTORICO_DIAS || 420);

/**
 * Cuánto histórico se recupera POR CICLO.
 *
 * El histórico no se trae de una sentada: se va estirando hacia atrás un poco en cada
 * vuelta. Así lo reciente está disponible desde el primer ciclo —que es lo que hace falta
 * para trabajar hoy— y el año entero acaba de llenarse solo al cabo de un rato, sin un
 * proceso de una hora que si se corta hay que volver a empezar.
 */
const HISTORICO_POR_CICLO = Number(process.env.SYNC_HISTORICO_POR_CICLO || 30);

/**
 * Y además, SIEMPRE, una repasada a los últimos días.
 *
 * `since` se fía de que PEDIDO toque `updatedAt` en cada cambio. Si alguna vez no lo hace
 * —una carga masiva, una corrección por SQL— ese pedido no vuelve a aparecer nunca. Un
 * repaso corto de los últimos días lo recoge igual. Cuesta poco y tapa el único agujero
 * que tiene el sincronizado incremental.
 */
const REPASO_DIAS = Number(process.env.SYNC_REPASO_DIAS || 3);

/**
 * Sólo los pedidos que LLEVAN domicilio.
 *
 * Apagado por defecto: el usuario quiere el catálogo completo y filtrarlo en pantalla.
 * Los que no llevan domicilio también valen —se ven en el mapa, y un pedido puede pasar a
 * llevarlo—. Con SYNC_SOLO_DOMICILIO=1 se restringe.
 */
const SOLO_DOMICILIO = process.env.SYNC_SOLO_DOMICILIO === '1';

/**
 * Y de ésos, sólo los que YA tienen el costo puesto.
 *
 * También apagado por defecto, y por un número: de los 1.243 pedidos con domicilio y
 * geolocalización de los últimos quince días, los que la APK ya cotizó son SEIS. Con esto
 * puesto, delivery se queda con seis pedidos y parece roto. Se pone a 1 el día que la APK
 * esté cotizando de verdad.
 */
const SOLO_COTIZADOS = process.env.SYNC_SOLO_COTIZADOS === '1';

const comoFecha = (d) => d.toISOString().slice(0, 10);

const delEspejo = () => ({
  source: 'pedido',
  ...(SUCURSAL_CODIGO ? { sucursalCodigo: SUCURSAL_CODIGO } : {}),
});

/**
 * La MARCA DE AGUA: lo más nuevo que ya tenemos, según PEDIDO.
 *
 * Es el `since` de la próxima petición —lo que se movió desde entonces— y es lo que hace
 * que un ciclo cueste nada. Sale de los propios datos y no de un contador: un contador se
 * adelanta si una tanda falla a medias, y entonces el espejo se salta pedidos para
 * siempre sin dar ningún error.
 *
 * Para el barrido del histórico sí hay un contador, y ahí sí vale: ver `posicionDelBarrido`.
 */
async function hastaDondeLlega() {
  const nuevo = await prisma.order.aggregate({ where: delEspejo(), _max: { pedidoUpdatedAt: true } });

  return { marca: nuevo._max.pedidoUpdatedAt ?? null };
}

/**
 * Por dónde va el barrido del histórico, y avanzarlo.
 *
 * Esto lo deducía de los datos —«empieza por el pedido más antiguo que tengo»— y estaba
 * mal: el espejo YA tenía pedidos de hace un año sueltos, de cuando se traía todo. Así
 * que el barrido arrancaba a 357 días y se saltaba entero el año de en medio, que es
 * justo lo que faltaba por recuperar. Se ve en el registro de la primera pasada: repasó
 * los últimos días y saltó directo a 2025-09-03.
 *
 * Guardar la posición sí vale. Que un contador se pueda adelantar aquí no rompe nada: lo
 * que se mueva sigue llegando por `since` en cada ciclo, y el barrido da la vuelta al año
 * una y otra vez, así que un día saltado se recoge en la pasada siguiente.
 */
async function posicionDelBarrido() {
  const s = await prisma.settings.findFirst({ select: { id: true, syncBarridoDia: true } });

  return s ? { id: s.id, dia: s.syncBarridoDia ?? 0 } : null;
}

async function avanzarBarrido(id, dia) {
  // Al llegar al final se vuelve a empezar: el histórico se repasa en bucle, así que
  // cualquier hueco —un tramo que falló, un día que PEDIDO tocó sin avisar— se acaba
  // tapando solo sin que nadie tenga que darse cuenta.
  await prisma.settings.update({ where: { id }, data: { syncBarridoDia: dia >= HISTORICO_DIAS ? 0 : dia } });
}

/** Los parámetros que comparten todas las peticiones. */
function parametrosBase() {
  const q = new URLSearchParams();
  if (SOLO_DOMICILIO) q.set('soloDomicilio', '1');
  if (SOLO_COTIZADOS) q.set('conCosto', '1');
  if (SUCURSAL_CODIGO) q.set('sucursalCodigo', SUCURSAL_CODIGO);
  // Los archivados TAMBIÉN: son 51.871 de 56.208 y ahí está casi todo el histórico.
  return q;
}

async function pedirOrders(q) {
  const res = await fetch(`${PEDIDO_API_URL}/integration/orders?${q}`, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`PEDIDO ${res.status}: ${await res.text().catch(() => '')}`);
  const { orders = [] } = await res.json();
  return orders;
}

/**
 * Un tramo de días. Se procesa y se suelta: no se acumulan 50.000 pedidos en memoria para
 * mandarlos al final, que es exactamente lo que tiró el proceso la vez anterior.
 */
async function porTramos(desdeDias, hastaDias, alTraer) {
  for (let d = hastaDias; d <= desdeDias; d += TRAMO_DIAS) {
    const hasta = comoFecha(new Date(Date.now() - d * 86400000));
    const desde = comoFecha(new Date(Date.now() - Math.min(d + TRAMO_DIAS - 1, desdeDias) * 86400000));
    const q = parametrosBase();

    q.set('desde', desde);
    q.set('hasta', hasta);
    q.set('limit', '5000');

    try {
      const orders = await pedirOrders(q);

      if (orders.length) await alTraer(orders, `${desde}..${hasta}`);
    } catch (e) {
      // Un tramo que falla no tumba el resto: se recogerá en la próxima pasada.
      log(`tramo ${desde}..${hasta} falló: ${e.message}`);
    }
    await sleep(150);
  }
}

/**
 * Lo que cambió desde la marca de agua, por páginas.
 *
 * Se pagina por la propia marca: se pide `since`, se procesa, y la siguiente petición
 * arranca del `updatedAt` más nuevo de lo que acaba de llegar. Sin eso, un lote de más de
 * `limit` pedidos devolvería siempre los mismos y el bucle no avanzaría nunca.
 */
async function porCambios(desde, alTraer) {
  let marca = desde;

  for (let vuelta = 0; vuelta < 200; vuelta++) {
    const q = parametrosBase();

    q.set('since', marca.toISOString());
    q.set('limit', '2000');

    const orders = await pedirOrders(q);

    if (!orders.length) return;

    await alTraer(orders, `cambios desde ${marca.toISOString()}`);

    const masNuevo = orders.reduce((max, o) => {
      const t = new Date(o.updatedAt || 0).getTime();
      return t > max ? t : max;
    }, 0);

    // Sin avance no hay nada más que traer, o PEDIDO no manda `updatedAt`: se para en vez
    // de girar en el sitio hasta el tope de vueltas.
    if (!masNuevo || masNuevo <= marca.getTime()) return;
    marca = new Date(masNuevo);
    await sleep(150);
  }
  log('sincronizado incremental: 200 vueltas y sigue habiendo cambios; se sigue en el próximo ciclo');
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
      // El PESO va tal cual viene de PEDIDO, que lo cruza contra Ventra con los vínculos
      // que ató una persona. Antes se tiraba aquí y delivery lo volvía a resolver con su
      // propio catálogo: el mismo dato dos veces, y discrepando sin que nadie lo viera.
      items: (pedido.items || []).map((it) => ({
        code: it.codigo, name: it.producto, quantity: it.unidades || 1, packs: it.packs, descripcion: it.descripcion,
        pesoKg: it.pesoKg ?? null, pesoLineaKg: it.pesoLineaKg ?? null,
      })),
      operationNumber: pedido.folio,
      externalId: pedido.id,
      // La fecha del PEDIDO. Sin ella, el Order nace con la de hoy —cuándo lo copió el
      // espejo— y filtrar por día en el armador de rutas devuelve cero cualquier otro día.
      orderDate: pedido.fecha ?? null,
      /**
       * Y todo lo que hace falta para poder FILTRAR el catálogo en el servidor.
       *
       * Estaba dentro de `meta` —el pedido entero— así que filtrar por municipio o por
       * estado obligaba a leer y descartar 50.000 pedidos completos en cada consulta.
       */
      pedidoUpdatedAt: pedido.updatedAt ?? null,
      estado: pedido.estado ?? null,
      archivado: pedido.archivado === true,
      fechaComprometida: pedido.fechaComprometida ?? null,
      pedidoCosto: pedido.costoDomicilio ?? null,
      municipio: pedido.cliente?.municipio ?? null,
      vendedor: pedido.vendedor?.nombre || pedido.vendedor?.codigo || null,
      sucursalCodigo: pedido.sucursalCodigo ?? null,
      // SOLO los marcados requiere_domicilio=true llevan costo. Los false (y los que no
      // traen el dato) se importan igual —hacen falta para las rutas y la capacidad del
      // camión— pero SIN precio de domicilio.
      requiereDomicilio: pedido.requiereDomicilio === true,
      /**
       * El cotejo contra la FACTURA, tal como lo dejó PEDIDO.
       *
       * Lo hace PEDIDO —el pedido es suyo, y es allí donde se corrige cuando la factura
       * dice otra cosa—. Aquí se copia para poder FILTRAR: el armador de rutas ofrece por
       * defecto los que cuadran, porque cargar el camión con un pedido que la factura
       * cambió es descuadrar la caja.
       *
       * Cuando PEDIDO corrige un pedido, sus líneas YA son las de la factura: por eso el
       * pre-despacho cuadra sin hacer nada aquí.
       */
      facturaEstado: pedido.facturaEstado ?? null,
      facturaNumero: pedido.facturaNumero ?? null,
      facturaAt: pedido.facturaAt ?? null,
      facturaDomicilio: pedido.facturaDomicilio ?? null,
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
  /**
   * Ya no se espera a que nadie configure nada.
   *
   * Esto frenaba el espejo entero hasta que alguien marcaba la fórmula como configurada
   * en la pantalla de Configuración — que ya no existe: el costo que se le cobra al
   * cliente lo pone el repartidor desde Entrega, y lo que se calcula aquí es el reparto
   * de la carga del camión, una cuenta interna.
   *
   * Dejar el guard sería que el día que alguien reinicie con la base limpia, el espejo
   * no traiga NADA y no haya pantalla donde arreglarlo.
   */
  const settings = await prisma.settings.findFirst();

  if (!settings) await prisma.settings.create({ data: { domConfigured: true } });
  else if (!settings.domConfigured) await prisma.settings.update({ where: { id: settings.id }, data: { domConfigured: true } });

  return true;
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
      // El código y el vendedor, a columnas: dentro de `meta` no se podían filtrar sin
      // leerse los siete mil clientes en cada consulta.
      codigo: c.codigo ?? null,
      vendedor: c.vendedor?.nombre ?? c.vendedor?.codigo ?? null,
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

/**
 * Un lote de pedidos: cotizarlo y guardarlo.
 *
 * Se trocea en 200 porque el reparto de carga se calcula por envío y 200 es un tamaño
 * realista de camión — y porque mandar miles en un solo POST es lo que reventó la
 * memoria la vez anterior.
 */
const LOTE = 200;

async function guardarLote(orders, de) {
  let guardados = 0;

  for (let i = 0; i < orders.length; i += LOTE) {
    try {
      const { byRef } = await quoteBatch(orders.slice(i, i + LOTE));

      guardados += byRef.size;
    } catch (e) {
      log(`lote ${i / LOTE + 1} de ${de} falló: ${e.message}`);
    }
    await sleep(200);   // sin esto, veinte lotes seguidos ahogan a delivery
  }
  log(`${de}: ${orders.length} pedidos, ${guardados} guardados`);
  return guardados;
}

/**
 * El CATÁLOGO de Ventra, cada doce horas.
 *
 * Lo trae delivery directamente de Ventra —no pasa por PEDIDO— porque es el dato del
 * almacén y PEDIDO no tiene por qué reenviarlo. Va aquí, en el espejo, y no en un botón:
 * un catálogo que hay que acordarse de importar se queda viejo el primer día que nadie
 * se acuerda, y entonces un pedido manual sale con un peso y un precio que ya no existen.
 *
 * Doce horas es lo mismo que hace PEDIDO: los precios se mueven un par de veces al día
 * como mucho, y Ventra se llega por VPN — un enlace que conviene no cargar por gusto.
 */
async function syncCatalogo() {
  /**
   * Si toca o no lo decide el propio endpoint.
   *
   * Aquí no se lleva la cuenta a propósito: el botón de «traer ahora» de la pantalla y
   * este sondeo comparten así la misma regla, en vez de tener dos que se puedan
   * contradecir. Contesta `{ saltado: true }` cuando la última foto es reciente.
   */
  const res = await fetch(`${DELIVERY_URL}/api/products/sync`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`catálogo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);

  const r = await res.json();

  return r?.saltado ? null : r;
}

/**
 * Los RECIÉN COTIZADOS, en cada vuelta.
 *
 * Es lo único que la gente mira esperando a que cambie: se cotiza en el teléfono y aquí
 * tiene que aparecer. El incremental por `since` ya los traería, pero sólo cuando la
 * marca de agua avanza; esto pregunta directamente por los que llevan costo y se movieron
 * hace poco, que son cuatro filas y llegan en la vuelta siguiente.
 */
const VENTANA_COTIZADOS_MIN = Number(process.env.SYNC_COTIZADOS_MIN || 30);

async function cotizadosRecientes() {
  const q = parametrosBase();

  q.set('soloDomicilio', '1');
  q.set('conCosto', '1');
  q.set('since', new Date(Date.now() - VENTANA_COTIZADOS_MIN * 60000).toISOString());
  q.set('limit', '500');

  const orders = await pedirOrders(q);

  if (!orders.length) return 0;
  return guardarLote(orders, 'recién cotizados');
}

/** El barrido del histórico es lo caro: no en cada vuelta. */
const BARRIDO_CADA_MS = Number(process.env.SYNC_BARRIDO_CADA_MS || 10 * 60 * 1000);
let ultimoBarrido = 0;

async function cycle() {
  if (!KEY) throw new Error('Falta SERVICE_API_KEY.');

  // El catálogo, si toca. Aislado: que Ventra no conteste no puede parar los pedidos.
  try {
    const r = await syncCatalogo();

    if (r) {
      log(`catálogo de Ventra: ${r.escritos} productos${r.conError ? `, ${r.conError} sucursal(es) con fallo` : ''}`);
      for (const s of r.sucursales || []) if (s.error) log(`  ${s.sucursal}: ${s.error}`);
    }
  } catch (e) {
    log('el catálogo de Ventra falló:', e.message);
  }

  // Sincroniza el mirror de clientes SIEMPRE (independiente de la fórmula/cotización).
  // Aislado en su try: si falla, no rompe el procesamiento de domicilios.
  try {
    const r = await syncCustomers();
    if (r.up || r.del) log(`clientes mirror: ${r.up} sincronizados, ${r.del} quitados`);
  } catch (e) {
    log('sync de clientes falló:', e.message);
  }

  // GUARD GLOBAL: sin fórmula, la cola entera espera. Se comprueba ANTES de traer nada:
  // pedirle a PEDIDO cincuenta mil pedidos para tirarlos no le hace gracia a nadie.
  if (!(await checkFormula())) {
    log('esperando configuración -> falta la FÓRMULA del domicilio (Ajustes). La cola queda en espera.');
    return;
  }

  const { marca } = await hastaDondeLlega();
  let total = 0;

  /**
   * 1. Lo que se movió desde la última vez. Es lo que hace que un ciclo cueste nada.
   */
  if (marca) {
    await porCambios(marca, async (orders, de) => { total += await guardarLote(orders, de); });
  }

  /**
   * 1.a Los recién cotizados. Es lo que se está mirando en pantalla.
   */
  try {
    const n = await cotizadosRecientes();

    if (n) log(`${n} pedidos recién cotizados`);
  } catch (e) {
    log('no se pudieron traer los recién cotizados:', e.message);
  }

  /**
   * 2. Una repasada corta a los últimos días, siempre.
   *
   * Tapa el único agujero del sincronizado incremental: un pedido cambiado sin que PEDIDO
   * tocara su `updatedAt` —una carga masiva, una corrección por SQL— no volvería a
   * aparecer nunca. Y es lo que llena el espejo la primerísima vez.
   */
  await porTramos(REPASO_DIAS, 0, async (orders, de) => { total += await guardarLote(orders, `repaso ${de}`); });

  /**
   * 3. Y se estira el histórico un poco más hacia atrás.
   *
   * Un trozo por ciclo, no el año de una sentada: lo reciente ya está desde el primer
   * ciclo, y si el proceso se reinicia a mitad la próxima vuelta sigue por donde iba —lo
   * dice el pedido más antiguo que hay guardado, no un contador que se puede adelantar—.
   *
   * Y no en CADA vuelta: ahora el ciclo pasa cada minuto para que el costo del domicilio
   * aparezca pronto, y pedirle a PEDIDO treinta días de histórico cada minuto es cargarlo
   * por gusto — lo viejo no se mueve.
   */
  if (Date.now() - ultimoBarrido < BARRIDO_CADA_MS) {
    if (total) log(`${total} pedidos guardados`);
    return;
  }
  ultimoBarrido = Date.now();

  const barrido = await posicionDelBarrido();

  if (barrido) {
    const desde = Math.max(barrido.dia, REPASO_DIAS);
    const hasta = Math.min(desde + HISTORICO_POR_CICLO, HISTORICO_DIAS);
    let delHistorico = 0;

    await porTramos(hasta, desde, async (orders, de) => {
      delHistorico += await guardarLote(orders, de);
    });
    total += delHistorico;
    await avanzarBarrido(barrido.id, hasta);

    log(`histórico: barridos los días ${desde}-${hasta} hacia atrás (${delHistorico} pedidos)`);
  }

  if (!total) log(`sin cambios${marca ? ` desde ${marca.toISOString()}` : ''}`);
}

// RECOMPUTE: recotiza TODOS los pedidos con la fórmula vigente y refresca los Order de
// delivery. Úsalo tras cambiar la fórmula, la tarifa o el vehículo de cálculo.
//
// Ya NO escribe nada en PEDIDO: el costo que ve el cliente lo pone la APK. Lo que se
// recalcula aquí es el reparto de carga para las rutas de delivery, y se queda aquí.
async function recomputeAll() {
  log(`recompute: recorriendo ${HISTORICO_DIAS} días y recotizando con la fórmula vigente`);

  let total = 0;

  await porTramos(HISTORICO_DIAS, 0, async (orders, de) => { total += await guardarLote(orders, de); });
  log(`recompute LISTO: ${total} pedidos recosteados en delivery (PEDIDO no se toca).`);
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
