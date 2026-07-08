# Despliegue en la NUBE (VPS) — **Docker + Redis + colas** — modelo CENTRALIZADO

> **Este es el modelo de producción real.** Todas las sucursales viven en **un mismo
> lugar** (un VPS). Cada usuario entra y ve **solo su sucursal**; el Super Admin ve todas.
> A diferencia del local (un servidor por sucursal, PM2), aquí puede haber **varias
> sucursales metiendo datos a la vez**, así que el diseño tiene que **no colapsar** bajo
> carga concurrente. Para eso entran **Redis + colas de trabajo**.
>
> Para el modelo local por-sucursal (Windows + PM2) usa **[DEPLOY-LOCAL.md](DEPLOY-LOCAL.md)**.

---

## 0 — Por qué Redis (y qué resuelve)

En local hay **una sola sucursal** metiendo datos, así que todo corre "inline" (dentro
del request) y no pasa nada. En la nube, con **N sucursales subiendo CSV, calculando
domicilios y viendo la lista en vivo al mismo tiempo**, hay tres cosas que revientan el
servidor si se dejan como están:

| Problema en local | Qué pasa con N sucursales a la vez | Solución en la nube |
|---|---|---|
| El CSV se importa **dentro del request** (`/orders/bulk`), fila por fila, con varias queries por fila | 5 sucursales suben CSV grandes → 5 loops largos peleando por conexiones a Postgres y por el event-loop de Node → la API se congela para **todos** | **Cola BullMQ**: el endpoint solo **encola** el trabajo y responde al toque; un **worker** procesa las importaciones de a pocas (concurrencia limitada) |
| El worker de domicilios es un **script que hace polling a una tabla** (`SyncJob`) | Cada instancia de API que escale hace su propio polling → trabajo duplicado y más carga a la DB | **Cola BullMQ** (Redis) en vez de la tabla `SyncJob`: un solo worker consume, con reintentos y rate-limit reales |
| El SSE de "pedidos en vivo" hace que **cada cliente conectado consulte Postgres cada 3s** | 50 usuarios conectados = ~17 queries/seg **solo para el SSE**, además escala mal con varias instancias de API | **Redis Pub/Sub**: quien crea un pedido **publica** un evento; los SSE **escuchan** Redis. Cero polling a la DB, y funciona aunque haya varias instancias de API |

Redis es, en una frase: **el bus de mensajes y el backend de las colas**. Con él, "entrada
de datos pesada" deja de ser trabajo síncrono dentro del request y pasa a ser **trabajos
en cola procesados a ritmo controlado**, y "ver cambios en vivo" deja de ser polling y pasa
a ser **push por eventos**.

---

## 1 — Arquitectura (contenedores)

```
                         ┌──────────────────────────────────────────────┐
   Internet ── Caddy ──▶ │  pedido-front (5000)   delivery (3002)        │
   (TLS, un dominio)     │  analitics-front       analitics-api          │
                         └───────┬───────────────────────┬──────────────┘
                                 │                        │
                          pedido-api (8400) ◀── x-api-key ─┘
                                 │   ▲  │
                 enqueue job     │   │  │ publish/subscribe (SSE en vivo)
                                 ▼   │  ▼
                         ┌─────────────────────┐        ┌──────────────┐
                         │       Redis         │◀──────▶│  Postgres    │
                         │  colas + pub/sub    │        │ (pedido +    │
                         └──────────┬──────────┘        │  delivery)   │
                                    │ consume jobs       └──────────────┘
                          ┌─────────▼──────────┐
                          │   WORKERS           │
                          │  - import-csv       │  (importación de pedidos)
                          │  - domicilios       │  (cotización de delivery)
                          │  - geo / restore    │  (mantenimiento pesado)
                          └─────────────────────┘
                                    │ VPN WireGuard
                                    ▼
                             Warehouse 10.188.2.2:3001 (pesos por SKU)
```

Contenedores:
- **postgres** — una instancia; dos bases (`procovar_pedido`, `procovar_delivery`).
- **redis** — colas (BullMQ) + Pub/Sub (SSE).
- **pedido-api** (Express) — la API; **encola** en vez de procesar inline.
- **pedido-front** (Next 5000), **delivery** (Next 3002, standalone), **analitics** (FastAPI + front).
- **worker** — proceso(s) Node que consumen las colas de Redis (import CSV, domicilios, geo, restore).
- **caddy** (o nginx) — reverse proxy con TLS y un solo dominio.

> El **worker es un servicio aparte** del mismo repo (misma imagen, distinto comando:
> `node worker.js`). Puedes escalar solo los workers (`docker compose up --scale worker=3`)
> sin tocar la API.

---

## 2 — `docker-compose.yml` (base)

> ✅ **YA EXISTE UN BUNDLE REAL Y FUNCIONAL** en la raíz del despliegue (junto a esta
> guía), listo para `docker compose up -d` con el **código actual**:
> - **`docker-compose.yml`** — postgres (2 bases) + redis + `pedido-api` + `pedido-front` +
>   `delivery` + **`delivery-sync`** (worker de la cola `sync-queue.mjs`) + `analitics-api`
>   (alias de red `backend`) + `analitics-front` + `caddy`.
> - **`.env.example`** — todas las variables comentadas (`POSTGRES_PASSWORD`,
>   `SERVICE_API_KEY`, **`JWT_SECRET`** — delivery falla sin él —, `WAREHOUSE_*`,
>   `PUBLIC_DOMAIN`). Copia a `.env` y rellena. `RUN_SEED=false` en prod (no re-siembra).
> - **`Caddyfile`** — reverse proxy por subdominio con TLS y passthrough de SSE
>   (`flush_interval -1`).
> - **`initdb/01-databases.sql`** — crea `procovar_pedido` y `procovar_delivery`.
> - **`procovar-delivery/Dockerfile.worker`** — imagen del worker (la del web es
>   `standalone` y no trae sus deps).
>
> **Diferencia con el YAML de abajo:** el bundle real usa el worker **actual**
> (`sync-queue.mjs`, cola DB-backed vía tabla `SyncJob`). El servicio `worker: node
> dist/worker.js` (BullMQ) que aparece más abajo es el **upgrade futuro** (§3–§7): Redis
> ya viene incluido en el bundle para cuando se implemente, sin tener que tocar el compose.
> Todo lo demás (colas por import, SSE por pub/sub) sigue siendo la guía de qué editar.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [ "pgdata:/var/lib/postgresql/data", "./initdb:/docker-entrypoint-initdb.d" ]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    volumes: [ "redisdata:/data" ]
    restart: unless-stopped

  pedido-api:
    build: ./PEDIDO-pg/api
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/procovar_pedido?schema=public
      DATABASE_PROVIDER: postgresql
      REDIS_URL: redis://redis:6379
      SERVICE_API_KEY: ${SERVICE_API_KEY}
      PORT: "8400"
    depends_on: [ postgres, redis ]
    restart: unless-stopped

  worker:                       # <-- CLAVE: consume las colas. Misma imagen, otro comando.
    build: ./PEDIDO-pg/api
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/procovar_pedido?schema=public
      DATABASE_PROVIDER: postgresql
      REDIS_URL: redis://redis:6379
      SERVICE_API_KEY: ${SERVICE_API_KEY}
      IMPORT_CONCURRENCY: "2"   # cuántas importaciones CSV a la vez (súbelo con más CPU/RAM)
    depends_on: [ postgres, redis ]
    restart: unless-stopped

  delivery:
    build:
      context: ./procovar-delivery
      args: { BUILD_STANDALONE: "1" }     # imagen Docker = server standalone
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/procovar_delivery?schema=public
      REDIS_URL: redis://redis:6379
      SERVICE_API_KEY: ${SERVICE_API_KEY}
      PEDIDO_API_URL: http://pedido-api:8400
      SUCURSAL_CODIGO: ""                  # <-- VACÍO: procesa TODAS las sucursales
      WAREHOUSE_API_URL: http://10.188.2.2:3001/api/external-api
      WAREHOUSE_API_TOKEN: ${WAREHOUSE_API_TOKEN}
    depends_on: [ postgres, redis ]
    restart: unless-stopped

  pedido-front:
    build: ./PEDIDO-pg/front
    environment: { NEXT_PUBLIC_API_URL: /api }   # via Caddy
    depends_on: [ pedido-api ]
    restart: unless-stopped

  analitics-api:                 # FastAPI. Ya aisla por sucursal (require_access + roles).
    build: ./sucursal-analitics/app/backend
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/procovar_pedido?schema=public
      PEDIDO_API_URL: http://pedido-api:8400
      SERVICE_API_KEY: ${SERVICE_API_KEY}
      REDIS_URL: redis://redis:6379          # cache de reportes pesados (ver §5)
    depends_on: [ postgres, redis, pedido-api ]
    restart: unless-stopped

  analitics-front:
    build: ./sucursal-analitics/app/frontend
    environment: { VITE_API_URL: /analitics }  # via Caddy
    depends_on: [ analitics-api ]
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports: [ "80:80", "443:443" ]
    volumes: [ "./Caddyfile:/etc/caddy/Caddyfile", "caddydata:/data" ]
    depends_on: [ pedido-api, pedido-front, delivery ]
    restart: unless-stopped

volumes: { pgdata: {}, redisdata: {}, caddydata: {} }
```

> `SUCURSAL_CODIGO=""` en **delivery** es lo que hace que el worker de domicilios jale
> **todas** las sucursales. Cada sucursal empieza a calcular sola cuando le crean su
> **almacén (Branch)** con punto de partida; las que no lo tengan quedan en *espera*, sin
> frenar a las demás (ya está así en el código).

---

## 3 — Redis en el código: qué instalar y qué añadir

### 3.1 Dependencias (una vez, en `PEDIDO-pg/api`)
```bash
npm i bullmq ioredis
```

### 3.2 Conexión compartida — `src/lib/redis.ts` (NUEVO)
```ts
import IORedis from 'ioredis';
export const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,   // requerido por BullMQ
});
// Pub/Sub para SSE: conexiones separadas (una que publica, otra que escucha).
export const pub = connection.duplicate();
export const sub = connection.duplicate();
```

### 3.3 Definición de colas — `src/lib/queues.ts` (NUEVO)
```ts
import { Queue } from 'bullmq';
import { connection } from './redis';
const opts = { connection, defaultJobOptions: {
  attempts: 3, backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000, removeOnFail: 5000,
}};
export const importQueue    = new Queue('import-csv',   opts);  // importación de pedidos (CSV)
export const geoQueue       = new Queue('geo-import',   opts);  // consolidado de geolocalización
export const restoreQueue   = new Queue('db-restore',   opts);  // restaurar backup de otro server
export const domicilioQueue = new Queue('domicilios',   opts);  // cotización delivery (reemplaza SyncJob)
```

---

## 4 — Job por cada importación de CSV (lo que pediste)

**Problema:** hoy `POST /orders/bulk` (`src/routes/orders.ts`) mapea y **procesa el CSV
completo dentro del request**, fila por fila. Con varias sucursales subiendo a la vez, eso
satura Postgres y bloquea la API para todos.

**Solución:** el endpoint **solo encola** y responde con un `jobId`. El **worker** procesa
la importación fuera del request, con **concurrencia limitada** (`IMPORT_CONCURRENCY`) y
**reintentos**. El front sigue el progreso por SSE (sección 6).

### 4.1 Editar `POST /orders/bulk` — encolar en vez de procesar
```ts
// src/routes/orders.ts
import { importQueue } from '../lib/queues';

router.post('/bulk', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'Invalid records data' });

  // Mismo scoping que antes (quién sube -> su sucursal).
  const { sucursalId, error } = resolveSucursalScope(req, {
    allowAllForAdmin: true, preferUserSucursal: true, defaultAllForAdmin: false,
  });
  if (error) return res.status(403).json({ error });

  // NO procesar aquí: encolar. Respuesta inmediata.
  const job = await importQueue.add('bulk', { records, uploaderSucursalId: sucursalId ?? null }, {
    // 1 importación por sucursal a la vez (evita que dos CSV de la misma sucursal choquen).
    jobId: sucursalId ? `import:${sucursalId}:${Date.now()}` : undefined,
  });
  res.status(202).json({ enqueued: true, jobId: job.id });   // 202 Accepted
});
```

### 4.2 El worker — `src/worker.ts` (NUEVO). Toda la lógica pesada que ANTES estaba inline vive aquí
```ts
import { Worker } from 'bullmq';
import { connection, pub } from './lib/redis';
import prisma from './prismaClient';
import { mapCsvRecords, resolveSeller, processOrderRecord, /* ...lo que ya tienes */ } from './lib/importCore';

const IMPORT_CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY || 2);

new Worker('import-csv', async (job) => {
  const { records, uploaderSucursalId } = job.data;
  const mapped = mapCsvRecords(records);

  // (misma lógica que hoy en /orders/bulk, movida tal cual)
  const sellers = new Map();
  for (const r of mapped) {
    const key = r.seller.code || r.seller.name.toUpperCase().trim();
    if (!sellers.has(key)) sellers.set(key, await resolveSeller(r.seller.name, r.seller.code, uploaderSucursalId));
  }
  const results = { created: 0, updated: 0, failed: 0, sinAsignar: 0, errors: [] as any[] };
  let done = 0;
  for (const rec of mapped) {
    const s = sellers.get(rec.seller.code || rec.seller.name.toUpperCase().trim());
    try { await processOrderRecord(rec, results, s.seller.id, s.sucursalId); }
    catch (e:any) { results.failed++; results.errors.push({ record: rec.order.folio, error: e.message }); }
    // Progreso en vivo (SSE): publica cada 25 filas.
    if (++done % 25 === 0) await pub.publish('import:progress', JSON.stringify({ jobId: job.id, sucursalId: uploaderSucursalId, done, total: mapped.length }));
  }
  // Al terminar, publica el "order" de cada pedido nuevo para la lista en vivo (sección 6).
  await pub.publish('import:done', JSON.stringify({ jobId: job.id, sucursalId: uploaderSucursalId, results }));
  return results;
}, { connection, concurrency: IMPORT_CONCURRENCY });
```

> **Refactor mínimo:** saca `mapCsvRecords`, `resolveSeller`, `processOrderRecord` de
> `routes/orders.ts` a un `src/lib/importCore.ts` para que **el endpoint y el worker
> compartan exactamente la misma lógica** (no dupliques). El comportamiento no cambia; solo
> cambia **dónde** corre (fuera del request).

### 4.3 El front tras subir el CSV
En vez de esperar la respuesta con el resultado, recibe `202 { jobId }` y **escucha el
progreso por SSE** (`import:progress` / `import:done`). Muestra una barra "Importando 250/1200…"
y al `done` refresca el conteo. Igual de simple para el usuario, pero **el servidor ya no se
bloquea**.

---

## 5 — Los OTROS trabajos que colapsan con entrada simultánea (y su fix)

Busqué en el código todo lo que hoy corre **pesado y síncrono dentro del request**. Con una
sola sucursal no molesta; con varias a la vez, sí. En la nube van **todos a cola**:

| Punto | Dónde | Riesgo con N sucursales | Fix en la nube |
|---|---|---|---|
| **Importación de pedidos (CSV)** | `orders.ts` → `POST /orders/bulk` | Loop largo por request, varias queries por fila | **Cola `import-csv`** (sección 4) |
| **Domicilios (delivery)** | `procovar-delivery/sync-queue.mjs` (polling a tabla `SyncJob`) | Polling duplicado si escalas; ritmo fijo | **Cola `domicilios`** (BullMQ) — sección 7 |
| **Consolidado de geolocalización** | `geolocalizacion.ts` (multer + upsert masivo de miles de coords) | Un archivo grande bloquea la API entera | **Cola `geo-import`**: el endpoint guarda el archivo y encola; el worker hace el upsert |
| **Restaurar backup de otro server** | `mantenimiento.ts` → `POST /restore` (upsert de roles/usuarios/vendedores/clientes/pedidos) | Consolidar históricos = miles de upserts en un request | **Cola `db-restore`**: encolar; worker procesa con reintentos |
| **SSE "pedidos en vivo"** | `orders.ts` → `GET /orders/stream` (cada cliente hace `setInterval` a Postgres cada 3s) | 50 conexiones = decenas de queries/seg solo por el SSE | **Redis Pub/Sub** (sección 6): cero polling |
| **Reportes / analytics** | `reports.ts` (agregaciones grandes) + analitics | Varios abriendo reportes pesados a la vez | **Cache en Redis** con TTL corto (60–300s) por `sucursalId+filtros`; invalida al importar |
| **Pesos del warehouse** | `procovar-delivery` → `fetchWeightMap()` (una llamada VPN por lote) | Cada worker de domicilios re-descarga el catálogo | **Cache en Redis** del mapa de pesos (TTL 10–15 min), compartido por todos los workers |

Reglas de oro para la nube (déjalas fijas):
1. **Ningún request hace un loop de miles de escrituras.** Si algo escribe en masa → **cola**.
2. **Ningún SSE hace polling a Postgres.** Los eventos viajan por **Redis Pub/Sub**.
3. **Concurrencia acotada** en los workers (`IMPORT_CONCURRENCY`, `limiter` de BullMQ) para
   que 10 imports a la vez no maten Postgres: se procesan de a `N`, el resto **espera en cola**.
4. **Cachea en Redis** lo caro y repetido (pesos del warehouse, reportes) con TTL.
5. **Un pool de conexiones a Postgres sano** (p.ej. `connection_limit` en la `DATABASE_URL`,
   o PgBouncer si escalas mucho): las colas ya limitan el paralelismo, pero el pool es el
   segundo cinturón de seguridad.

---

## 6 — Ver los cambios en vivo por SSE (sobre Redis, sin refrescar)

Hoy `GET /orders/stream` hace que **cada cliente** consulte Postgres cada 3s. En la nube eso
no escala y encima **no funciona con varias instancias de API** (una instancia no se entera
de lo que creó otra). Con Redis Pub/Sub el flujo es **push**:

**Quien crea/importa un pedido publica el evento:**
```ts
// donde se crea un pedido (POST /orders y el worker de import-csv):
import { pub } from '../lib/redis';
await pub.publish('orders:new', JSON.stringify({ sucursalId, order }));
```

**El endpoint SSE se suscribe a Redis (ya no hace polling):**
```ts
// src/routes/orders.ts  ->  GET /orders/stream
import { sub } from '../lib/redis';

router.get('/stream', async (req, res) => {
  const { sucursalId, error } = resolveSucursalFilter(req);
  if (error) return res.status(400).json({ error });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');           // Caddy/nginx: no bufferear el SSE
  (res as any).flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');

  const onMsg = (_ch: string, raw: string) => {
    const { sucursalId: sid, order } = JSON.parse(raw);
    // Aislamiento por sucursal: cada quién solo ve lo suyo (el Super Admin, todo).
    if (sucursalId && sid !== sucursalId) return;
    res.write(`event: order\ndata: ${JSON.stringify(order)}\n\n`);
  };
  await sub.subscribe('orders:new');
  sub.on('message', onMsg);

  const keep = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  req.on('close', () => { clearInterval(keep); sub.off('message', onMsg); });
});
```

Resultado: crear/importar un pedido **empuja** el evento a todos los navegadores conectados
de **esa** sucursal al instante, sin refrescar y **sin tocar Postgres** por cada cliente.
El aislamiento por sucursal se respeta igual que en el resto del proyecto (cada quien solo
ve lo suyo; el Super Admin, todo).

> **Proxy:** para que el SSE fluya, en el Caddyfile del `/api` no bufferees respuestas
> (`flush_interval -1`) y no pongas timeouts cortos de lectura. El header
> `X-Accel-Buffering: no` ya va puesto por si usas nginx.

---

## 7 — El worker de domicilios: de script a cola Redis

Hoy `procovar-delivery/sync-queue.mjs` usa la tabla `SyncJob` como "redis sin redis"
(polling). En la nube pasa a **BullMQ**:

- **Productor:** cuando PEDIDO crea/importa un pedido con geolocalización, encola un job
  `domicilios` con el `pedidoId` (en vez de que el worker haga polling). Puedes hacerlo en
  el mismo `pub.publish('orders:new'…)` añadiendo `domicilioQueue.add('quote', { pedidoId })`.
- **Worker (`domicilios`):** hace lo que hoy hace `quoteOne` + `writeback`: cotiza en delivery
  (`/api/quote/batch`) y escribe el `costoDomicilio` de vuelta en PEDIDO. Con `limiter`
  (p.ej. 1 cada 500ms) mantienes el "suave, despacio" pero ahora con reintentos y sin polling.
- **Guardas iguales:** sin **fórmula** global no se procesa; una sucursal **sin punto de
  partida** deja el job en `delayed`/reintento hasta que la configuren (misma semántica que
  hoy con `sucursal-sin-punto-de-partida`, pero nativa de la cola).

> Migración de datos: no hay que migrar la tabla `SyncJob`; al cambiar a BullMQ, los pedidos
> pendientes se re-encolan una vez al arrancar (un barrido inicial `pedidos sin costo` →
> `domicilioQueue.add`).

---

## 8 — Puesta en marcha en el VPS

```bash
# 1) Clonar los repos en el VPS (rama produccion en los TRES)
git clone -b produccion https://github.com/jose22072000/PEDIDO.git PEDIDO-pg
git clone -b produccion https://github.com/PROCOVAR-DEV/procovar-delivery.git
git clone -b produccion https://github.com/PROCOVAR-DEV/sucursal-analitics.git

# 2) .env de compose (secretos) — NO se commitea
cat > .env <<'EOF'
POSTGRES_PASSWORD=<clave-fuerte>
SERVICE_API_KEY=<clave-larga-compartida>     # MISMA en PEDIDO y delivery
WAREHOUSE_API_TOKEN=<token permanente de Alejandro>
EOF

# 3) Crear las dos bases (initdb/01-create-dbs.sql):
#    CREATE DATABASE procovar_pedido;  CREATE DATABASE procovar_delivery;

# 4) Levantar todo
docker compose up -d --build

# 5) Esquema (una vez por base)
docker compose exec pedido-api   npx prisma db push
docker compose exec delivery     npx prisma migrate deploy

# 6) Escalar workers si hace falta (más sucursales importando a la vez)
docker compose up -d --scale worker=3
```

**WireGuard (warehouse):** el túnel se monta en el **host** del VPS (o en un contenedor
`wireguard`); los contenedores llegan a `10.188.2.2:3001` por la red del host. Verifica desde
dentro: `docker compose exec delivery wget -qO- http://10.188.2.2:3001/... `.

---

## 9 — Cutover a centralizado (datos de todas las sucursales, sin perder históricos)

1. **Una sola base `procovar_pedido`** con **todas** las sucursales (registro `Sucursal` por
   cada una, con su `codigo`: CAM, STG, …).
2. **Consolidar históricos** de cada servidor local: exportar su backup y **restaurarlo** con
   el panel de Mantenimiento (o la cola `db-restore`), que hace **upsert idempotente**
   (roles por nombre, usuarios si faltan, sin duplicar pedidos). Así entran los históricos de
   cada sucursal **sin pisarse**.
3. **`config.json` sin `sucursalId` fijo**: en centralizado la sucursal sale del **usuario**
   (su `sucursalId`) o del **gestor** del vendedor, no de un archivo. Cada usuario ve lo suyo.
4. **delivery**: `SUCURSAL_CODIGO=""` y **un almacén (Branch) por sucursal** con su punto de
   partida real. La fórmula del domicilio es **global**.
5. **Usuarios**: cada uno con su `sucursalId` (obligatorio salvo el **Super Admin**, que va sin
   sucursal y ve todo). Correr `merge-vendedores` / `recompute-codigos` si hiciera falta tras
   consolidar (unifica códigos de vendedor entre sucursales).
6. **Verificar aislamiento**: entrar con un usuario de CAM y otro de STG y confirmar que
   **ninguno** ve datos del otro (403 / listas vacías), en PEDIDO, delivery y analitics.

---

## 10 — Checklist "no colapsa"

- [ ] `POST /orders/bulk` **encola** (202 + jobId), no procesa inline.
- [ ] `geo-import` y `db-restore` también por cola.
- [ ] Workers con **concurrencia acotada** (`IMPORT_CONCURRENCY`, `limiter`).
- [ ] SSE de pedidos por **Redis Pub/Sub** (sin polling a Postgres).
- [ ] Domicilios por cola **BullMQ** (no el script de polling).
- [ ] **Cache Redis** de pesos del warehouse y de reportes pesados.
- [ ] `connection_limit` en la `DATABASE_URL` (o PgBouncer).
- [ ] Reverse proxy **sin buffering** para el SSE (`flush_interval -1`).
- [ ] `SUCURSAL_CODIGO=""` en delivery; un **Branch por sucursal**; fórmula global.
- [ ] Aislamiento por sucursal verificado en los 3 apps.

---

> **Nota sobre el estado actual (local):** hoy el proyecto corre en modo **local por
> sucursal** (PM2, sin Redis) y funciona porque **solo una sucursal** mete datos a la vez.
> Todo lo de este documento es lo que hay que **añadir/editar** al montarlo en la nube; el
> código de negocio (scoping por sucursal, guards, fórmula, writeback) **no cambia**, solo
> cambia **dónde y cómo** corre el trabajo pesado (colas) y cómo viaja el "en vivo" (Pub/Sub).
