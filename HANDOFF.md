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
    npx prisma generate && npx prisma migrate deploy      # si hay migración nueva
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
- ⬜ Opcional futuro: flujo para GUARDAR un cliente manual (source=null) desde delivery (hoy el form manual crea la orden pero no persiste un Customer).

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
