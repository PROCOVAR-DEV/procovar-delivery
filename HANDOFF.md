# PROCOVAR — Handoff de contexto (para continuar en otra PC)

> Lee esto al abrir sesión en otra máquina para seguir donde se dejó.
> **Workflow del equipo:** planear con **fable**, desarrollar el plan con **opus**.
> Credenciales/accesos en `ssh.txt` (NO commitear). Docs relacionados:
> `RUNBOOK-procovar.md`, `REDIS-ROLLOUT.md`.

## Repos y ramas
Rama de trabajo en los 3: **`produccion`**. Remotos:
- `PEDIDO` → `jose22072000/PEDIDO`
- `procovar-delivery` → `PROCOVAR-DEV/procovar-delivery`
- `sucursal-analitics` → `PROCOVAR-DEV/sucursal-analitics`

## Infra (2 hosts)
- **VPS `72.60.115.124`** (compartido con ERPNext/n8n). Todo procovar aquí.
  - **PEDIDO**: docker — `procovar-api`(:8400), `procovar-front`(host **5001**→5000), `procovar-postgres`(:5433 `procovar_pedidos`), `procovar-worker` (cola import), `procovar-redis`(redis:7).
  - **DELIVERY**: systemd nativo `procovar-delivery` (Next :3000) + `procovar-delivery-sync` (worker `sync-queue.mjs`). Corre desde `~/projects/delivery/usa` (git, produccion). Postgres nativo :5432 `procovar_delivery`.
  - **ANALITICS**: systemd `analitics` (gunicorn) + front estático. Corre desde `~/projects/analitics` (git). **Sin DB** (usa JSON + API de PEDIDO). Dominio `analitics.marketplacecuba.com`.
  - **nginx del HOST** rutea los dominios (`pedidos.`/`delivery.`/`analitics.marketplacecuba.com`) + `/api` → backends. Es root (devops).
- **Hostinger `82.29.157.131`**: quedó redundante (analitics ya vive en el VPS).

## Deploy (qué puede jose)
- **ANALITICS** (self-serve): `ssh jose@72.60.115.124` → `cd ~/projects/analitics && ./deploy.sh`.
- **PEDIDO** (self-serve): `cd ~/projects/pedido && git pull` + `sudo docker compose -f /root/pedido/api/docker-compose.yml build && up -d` (idem `front`). `/root/pedido` == `~/projects/pedido` (mismo checkout). Los `docker-compose.yml`/`.env`/`nginx.conf` del VPS **divergen del repo a propósito** (secretos reales; puerto front `5001:5000`).
- **DELIVERY** — ⚠️ LEER, aquí es fácil tumbarlo:
  - `~/projects/delivery` es **BIND MOUNT de `/root/delivery`** (mismo dir, escribible por jose). El código está en `~/projects/delivery/usa` (git, rama produccion).
  - Corre por **systemd `procovar-delivery`** desde `/root/delivery/usa/.next/standalone/server.js` — Next en **modo STANDALONE** (`output:'standalone'` solo si `BUILD_STANDALONE=1`).
  - **DEPLOY correcto (desde `~/projects/delivery/usa`):**
    ```
    git pull
    npx prisma generate                                   # SIEMPRE antes del build (si el
                                                          # cliente queda viejo, tsc del build FALLA)
    npx prisma migrate deploy                             # si hay migración nueva (NO regenera el cliente)
    BUILD_STANDALONE=1 npm run build                       # OBLIGATORIO el flag
    cp -r .next/static  .next/standalone/.next/static      # standalone NO incluye assets
    cp -r public        .next/standalone/public
    sudo /usr/bin/systemctl restart procovar-delivery      # RUTA COMPLETA (ver abajo)
    sudo /usr/bin/systemctl restart procovar-delivery-sync # worker sync-queue.mjs
    ```
  - 🔴 **NUNCA** `npm run build` sin `BUILD_STANDALONE=1`: borra `.next/standalone` → el servicio no arranca (CHDIR/`server.js` 502). Error ya cometido una vez.
- Sudo de jose (whitelist exige **RUTA COMPLETA `/usr/bin/systemctl`**, `sudo systemctl` a secas pide password): `start|stop|restart|reload|status|enable|disable` de `procovar-delivery`, `procovar-delivery-sync`, `analitics`; `journalctl -u <esos>`; `docker compose -f /root/pedido/{api,front}/... *`; `docker ps`. NO: `docker logs`/`ps -a`/`is-active` (no whitelisted), git en `/root`, nginx, crear servicios.

## Estado — Redis rollout (COMPLETO y desplegado)
- **R1** PEDIDO SSE pedidos por pub/sub (auth por **ticket efímero**, no token en URL). ✅ vivo.
- **R2** PEDIDO cola import CSV (Bull) + worker + progreso por SSE. `IMPORT_USE_QUEUE=true` activo. ✅ vivo.
- **R4a** DELIVERY SSE sync por pub/sub. ✅ vivo.
- **R5** DELIVERY cache Redis del catálogo de pesos del warehouse. ✅ vivo.
- Todo **seguro por defecto**: sin `REDIS_URL` cae al comportamiento previo. Redis = `procovar-redis` (prefijos `procovar-pedido:*` / `procovar-delivery:*`).

## Features/fixes recientes
- ANALITICS: vista "Todas las sucursales" (Resumen combinado) + ranking comparativo para gestores (badge "tú") + tabla de TODOS los productos con scroll interno + config en "Todas" (grilla). Login admin: el pass fue cambiado (no es admin/admin).
- PEDIDO: rol **Supervisor** puede llevar vendedores (había 0 Gestores → 130 pedidos ocultos). Fix filtros de usuarios por sucursal + `isGlobalAdmin` consistente ("SUPER ADMIN").
- PEDIDO front infra: nginx sin proxy `/api` roto + puerto `5001` (bug que tumbaba el front).

## EN CURSO — Mirror de clientes PEDIDO→DELIVERY
Objetivo: delivery espeja los clientes de PEDIDO (como products del warehouse) pero **auto-sincronizado** (no manual) y **solo geolocalizados** (sin geo no hay costo). Se selecciona el cliente al crear una orden desde la ruta → sale el costo.
- ✅ PEDIDO `GET /integration/clients` (solo con geo, x-api-key) — **desplegado**.
- ✅ DELIVERY modelo `Customer` + migración `20260724150000_add_customer_mirror` (externalId único).
- ✅ DELIVERY `sync-queue.mjs` → `syncCustomers()` cada ciclo (upsert + borra los que ya no vienen; no borra ante fallo). Auto, sin botón.
- ✅ DELIVERY `GET /api/customers?q=` (lista/busca el mirror).
- ✅ **DELIVERY desplegado**: migración aplicada (tabla `Customer`), Next standalone + worker sync (corre `syncCustomers()`). El mirror se llena solo cuando haya clientes con geo.
- ✅ **UI desplegada**: `CustomerPicker` en `routes/page.tsx` (form `PedidoForm`) → busca el mirror, al elegir autocompleta nombre + dirección + lat/lng → cotiza. Los campos manuales quedan de fallback.
- ✅ **`Customer` = MISMO patrón que `Order`**: `source` ("pedido" sincronizado / null manual) + `externalId` (idempotente por `[source, externalId]`) + `meta` (payload completo). El sync solo toca/borra los de `source="pedido"` → los clientes manuales (source=null, creados desde delivery) quedan intactos, igual que las orders.
- ✅ **FEATURE COMPLETA en código.** Solo falta DATA: geolocalizar clientes en PEDIDO (sin geo el picker muestra "no hay clientes geolocalizados").
- ✅ **Clientes manuales** (source=null, local delivery, NO tocan PEDIDO): se crean desde 2 lados — página **`/customers`** (lista PEDIDO+manuales con badge de origen + form) y botón "Guardar cliente" en crear-ruta (`PedidoForm`). Endpoint `POST /api/customers`. El sync solo borra source="pedido".

## Moneda USD/CUP (delivery)
`useCurrency()` (`@/lib/useCurrency`) convierte montos USD → moneda elegida por la tasa
(`Settings.cupRate`); toggle en el Navbar. Los montos se GUARDAN en USD (fuente de
verdad), solo el display convierte. Aplicado en: PricingSummaryCard, orders, dashboard,
reports, routes, sync, vehicles (lista). ⬜ Pendiente si se quiere: convertir los INPUTS
de config editables (formula en settings, `costoKmUsd` en el form de vehículos) — hoy se
editan en USD (convertir bidireccional al editar es aparte, por el redondeo).

## EN CURSO — Event-driven (sin polling) + colas entrada/salida
Objetivo (pedido del usuario): NADA de polling. Delivery no debe preguntar cada 15s si
hay pedido/cliente nuevo; PEDIDO **avisa** cuando se crea → delivery reacciona. Colas
Bull separadas por dirección (`in:*` entrada / `out:*` salida) para fluir en paralelo.
- ✅ **Slice 1 (PEDIDO, desplegado, INERTE):** `enqueueDeliveryOrders()` encola en la cola
  durable `procovar-delivery:in:orders` al crear pedido (POST /orders), importar (bulk) y
  geolocalizar (geo-import). **Gated por `DELIVERY_EVENTS=true`** (off → no encola, nada
  cambia). `queues.ts` ahora tiene `makeQueue()` genérico + `deliveryOrdersQueue()`.
- ✅ **Slice 2 (DELIVERY, código desplegado, INERTE):** `bull` añadido; `sync-queue.mjs`
  consume `procovar-delivery:in:orders` y corre `cycle()` por evento (SIN poll) + red de
  seguridad lenta (`SAFETY_POLL_MS`, default 5min, 0 apaga). Gated por `DELIVERY_EVENTS`
  (false → poll de 15s actual, fallback/rollback).
- ✅ **CUTOVER HECHO — event-driven ACTIVO (verificado e2e):**
  - **Delivery corre SYSTEMD-NATIVO en el host** (NO docker): `procovar-delivery.service` =
    `node /root/delivery/usa/.next/standalone/server.js`; `procovar-delivery-sync.service` =
    `node /root/delivery/usa/sync-queue.mjs`. No hay contenedor delivery en `docker ps`.
  - Por eso `procovar-redis` (docker) se **publicó al host**: `ports: ["127.0.0.1:6379:6379"]`
    en el servicio `redis` del compose del api. Delivery usa `REDIS_URL=redis://127.0.0.1:6379`.
    Esto **también activó R4a/R5** (antes en fallback; ahora sí usan Redis).
  - `DELIVERY_EVENTS=true` en el `.env` de delivery **y** en el `x-api-env` del compose del api.
  - Worker loguea `event-driven: escuchando procovar-delivery:in:orders (SIN poll de 15s)`.
    Test e2e OK: encolar un job → el worker corre un ciclo.
  - **Rollback**: `DELIVERY_EVENTS=false` en ambos + reiniciar → vuelve al poll de 15s.
- ⬜ **(Opcional) Dockerizar delivery** (lo pidió el usuario, por consistencia con pedido):
  migración del devops (systemd→docker). El contenedor necesitaría alcanzar: Postgres NATIVO
  `:5432`, la VPN del warehouse (10.188.x) y el api `:8400` → probablemente `network_mode: host`
  o rutas al host. NO hace falta para que funcione (ya funciona nativo). jose NO tiene whitelist
  de compose para delivery (solo pedido).
- ⬜ **Slice 3 (colas out) — DIFERIDO a propósito:** separar `out:quote`/`out:writeback` en Bull.
  Bajo valor: la salida YA tiene cola durable con reintentos (tabla `SyncJob`, MAX_ATTEMPTS). No
  vale el riesgo en el hot-path ahora.
- ⬜ **Productos auto-sync:** el WAREHOUSE es EXTERNO (sin webhooks) → NO puede ser
  event-driven. El devops (dueño) debe exponer: **(A) webhook** `POST /api/products/webhook`
  al cambiar un producto (ideal), o **(B)** `GET /products/weights?updatedSince=<ISO>` para
  pulls de delta. Con A: `Product` = mirror global auto-actualizado (quitar `userId`). Sin
  eso, solo pull espaciado / cache R5 (10min).

## Bloqueos de DATOS (no de código)
- **0 de 115 clientes en PEDIDO tienen geo** → el mirror y la cotización quedan vacíos hasta **geolocalizar** (import del Consolidado .xlsx en PEDIDO). El usuario lo cargará luego + está descargando las bases de todas las sucursales.
- DELIVERY sync frenado por: **fórmula del domicilio** (`Settings.domConfigured=false`) + **0 Branches** (punto de partida). Configurar en la UI de delivery.

## Pendientes / próximos
1. Geolocalizar clientes (data) + cargar bases de todas las sucursales.
2. Deploy DELIVERY (mirror) + construir la UI del selector.
3. Configurar fórmula domicilio + almacén (Branch) en delivery.
4. **n8n** (`http://72.60.115.124:5678`): workflow que controla sucursales con "tablets padres" (Google Drives de cada cuenta). Falta definir disparador/pasos/acceso.
5. Futuro: migrar las 3 apps a Go (recursos).

## Gotchas
- 🔴🔴 **SECRETOS DIVERGENTES EN EL VPS (leer o rompés prod):** en el VPS, `~/projects/pedido/api/docker-compose.yml` (y el del front, y los `.env`) tienen **SECRETOS REALES inline** (`JWT_SECRET`, `SERVICE_API_KEY`, etc.) que **NO están en el repo** (el repo tiene placeholders: `JWT_SECRET=change_this...`, sin `SERVICE_API_KEY`/`REDIS_URL`, sin servicios redis/worker). Son cambios de working-tree, **no commiteados**. → **NUNCA** hacer `git clone` de nuevo, `git checkout -- <compose>`, `git reset --hard`, `git stash` en esos dirs: BORRA los secretos → el siguiente `up -d` levanta el api con JWT placeholder (invalida sesiones), sin `SERVICE_API_KEY` (delivery da 401) y sin Redis. **Ya pasó una vez** (un re-clone los borró; se reconstruyó a mano el `2026-07-26`). Los **valores reales NO van aquí** (esto se commitea): están en el compose/`.env` del VPS. `SERVICE_API_KEY` del api == el del `.env` de delivery. **RECOMENDADO (devops):** mover esos secretos a un `.env` gitignoreado (`env_file:` en el compose) para que git no los toque nunca.
- El compose del api del VPS define 4 servicios: **postgres, redis, api, worker** (worker = misma imagen, `command: node dist/worker.js`). El repo solo tiene postgres+api.
- EventSource no manda headers → SSE usan `?ticket=` (endpoint `POST /orders/sse-ticket`).
- `IMPORT_USE_QUEUE=true` **requiere** el worker corriendo (imagen `api-worker`).
- `SERVICE_API_KEY` debe ser IGUAL en PEDIDO api y en el `.env` de delivery (si difieren → sync de delivery da 401).
