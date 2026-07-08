# Despliegue LOCAL (por sucursal) — Windows + PM2

Guía **genérica** para instalar el sistema en **cualquier PC de sucursal** (Camagüey,
Santiago, Las Tunas, …). Todo corre **local en el mismo server**, sin nube. Comandos en
**PowerShell**; para bloques con `set -a` usa **Git Bash**.

> Sustituye en toda la guía `XXX` por el **código de tu sucursal** (CAM, STG, TUN, HOL, …).

---

## 0 — Qué se instala

| App | Qué es | Puerto | BD | PM2 |
|---|---|---|---|---|
| **PEDIDO api** | API de pedidos (Express + Prisma 7) | **8400** | PostgreSQL `procovar_pedidos` | `procavar-api` |
| **PEDIDO frontend** | UI de pedidos (React) | **5000** | — | `procavar-frontend` |
| **delivery** | Cálculo de domicilios (Next.js + Prisma 5) | **3002** | PostgreSQL `procovar_delivery` | `procovar-delivery` |
| **delivery-sync** | Worker cola de domicilios | — | usa `procovar_delivery` | `procovar-delivery-sync` |
| **analitics** | Análisis (FastAPI + React) | (según instalación) | — | `sucursal-api` / `sucursal-frontend` |
| **Data Warehouse** | Pesos de productos (remoto, read-only) | `10.188.2.2:3001` | — (solo por **VPN**) | — |

**Flujo:** el delivery **jala** los pedidos de PEDIDO, calcula el **costo de domicilio**
(distancia almacén→cliente × fórmula, con el **peso** que da el warehouse por la VPN) y
**escribe el costo de vuelta** en PEDIDO. Todo por HTTP, scopeado a la sucursal.

**Clave compartida:** un `SERVICE_API_KEY` **idéntico** en PEDIDO y delivery (header `x-api-key`).

---

## 1 — Requisitos previos

1. **Node.js 20+** y **git** (`node -v`, `git --version`).
2. **PM2** global: `npm i -g pm2`.
3. **PostgreSQL 16** (ver paso 2).
4. **WireGuard** con el túnel de la sucursal **activo** (ver paso 6). Cada server tiene su
   propio túnel y sube solo como servicio.
5. Acceso a los repos (por HTTPS con credenciales guardadas, o token):
   - PEDIDO: `https://github.com/jose22072000/PEDIDO`
   - delivery: `https://github.com/PROCOVAR-DEV/procovar-delivery`
   - analitics: `https://github.com/jose22072000/sucursal-analitics`
6. El **token permanente del warehouse** (lo da Alejandro).

---

## 2 — PostgreSQL

```powershell
winget install -e --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements
```
> ⚠️ **Gotcha:** vía winget el instalador **no pide contraseña** y deja el superusuario
> `postgres` con clave **`postgres`**. Cámbiala y crea las bases:

```powershell
$PSQL = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
& $PSQL -U postgres -h localhost -c "ALTER USER postgres PASSWORD 'root';"   # elige tu clave
& $PSQL -U postgres -h localhost -c "CREATE DATABASE procovar_pedidos;"
& $PSQL -U postgres -h localhost -c "CREATE DATABASE procovar_delivery;"
```

---

## 3 — Clonar los repos

```powershell
git clone https://github.com/jose22072000/PEDIDO.git            C:\Software\PEDIDO
git clone https://github.com/PROCOVAR-DEV/procovar-delivery.git C:\Software\procovar-delivery
git clone https://github.com/jose22072000/sucursal-analitics.git C:\Software\sucursal-analitics
```
> Si una carpeta ya existe y **no es git** (copia manual), no la pises: clónala aparte y
> migra los datos con `export-all.mjs` / `import-all.mjs` (ver paso 4C).

---

## 4 — PEDIDO (Postgres)

### 4A. Env
`PEDIDO/api/.env`:
```
NODE_ENV=production
PORT=8400
DATABASE_PROVIDER=postgres
DATABASE_URL="postgresql://postgres:root@localhost:5432/procovar_pedidos?schema=public"
JWT_SECRET=pon-un-secreto-largo
CORS_ORIGIN=*
SERVICE_API_KEY=una-clave-larga-compartida
```
> `prisma.config.mjs` elige el provider por `DATABASE_PROVIDER` (o Postgres si
> `NODE_ENV=production`). PEDIDO usa **Prisma 7 con driver adapter**.

### 4B. Instalar + crear el esquema en Postgres
```powershell
cd C:\Software\PEDIDO\api
npm install
npx prisma generate
# Las migraciones del repo son de SQLite; para Postgres crea el esquema con db push:
$env:DATABASE_PROVIDER="postgres"; npx prisma db push
npm run build
```

### 4C. Datos — dos caminos
- **Instalación nueva (vacía):** sigue directo al 4D.
- **Migrando desde un PEDIDO viejo en SQLite (sin perder nada):**
  ```powershell
  # en el PEDIDO viejo (SQLite), exporta TODO a un JSON:
  $env:DATABASE_PROVIDER="sqlite"; $env:DATABASE_URL="file:./prisma/dev.db"
  node export-all.mjs --out C:\Software\export-pedido.json
  # en el PEDIDO nuevo (Postgres), importa (upsert por id, idempotente):
  $env:DATABASE_PROVIDER="postgres"
  node import-all.mjs --in C:\Software\export-pedido.json
  ```

### 4D. Marcar la sucursal + cargar geo
```powershell
cd C:\Software\PEDIDO\api
# 1) Sucursal.codigo = XXX (tu código). Con Prisma Studio o SQL:
#    UPDATE "Sucursal" SET codigo='XXX' WHERE nombre ILIKE '%tu-sucursal%';
# 2) config.json -> sucursalId REAL de ESTA instalación (¡no copiado de otra!):
#    { "sucursalId": "<id real de la Sucursal en ESTA BD>" }
# 3) Backfill: los pedidos/clientes viejos quedan con sucursalId NULL tras la
#    migración multi-sucursal -> asígnalos a la sucursal:
#    UPDATE "Order"  SET "sucursalId"='<id>' WHERE "sucursalId" IS NULL;
#    UPDATE "Client" SET "sucursalId"='<id>' WHERE "sucursalId" IS NULL;
# 4) Geo (el importador matchea por sucursalId + nombre; hazlo DESPUÉS del backfill):
node import-geolocalizacion.mjs --dry     # revisa el % de match
node import-geolocalizacion.mjs           # escribe lat/lng en los clientes
```
> ⚠️ **Orden importa:** primero backfill de `sucursalId`, luego geo (si no, 0 match).

### 4E. PM2
```powershell
cd C:\Software\PEDIDO
pm2 start ecosystem.config.js    # procavar-api (8400) + procavar-frontend (5000)
```

---

## 5 — delivery (Postgres)

> delivery **se queda en Postgres**: su esquema usa campos `Json` que **SQLite no
> soporta** en Prisma. No intentes pasarlo a SQLite.

### 5A. Env
`procovar-delivery/.env`:
```
DATABASE_URL="postgresql://postgres:root@localhost:5432/procovar_delivery?schema=public"
JWT_SECRET=otro-secreto-largo
NEXT_PUBLIC_APP_URL="http://localhost:3002"
SERVICE_API_KEY=una-clave-larga-compartida          # MISMA que en PEDIDO
WAREHOUSE_API_URL="http://10.188.2.2:3001/api/external-api"
WAREHOUSE_API_TOKEN=<token permanente de Alejandro>
PEDIDO_API_URL="http://localhost:8400"
DELIVERY_URL="http://localhost:3002"
SUCURSAL_CODIGO="XXX"
```

### 5B. Instalar + migrar + build
```powershell
cd C:\Software\procovar-delivery
npm install
npx prisma migrate deploy
npx prisma generate
npm run build      # build NORMAL (no standalone) -> `next start` sin warning
```
> ℹ️ **standalone solo para Docker.** `next.config.js` emite `output: standalone`
> **únicamente** si `BUILD_STANDALONE=1` (lo setea el Dockerfile). Bajo PM2 se corre
> con `next start`; si el build fuera standalone, cada arranque escupiría el warning
> *"next start does not work with output: standalone"* al `delivery-error.log`. En local
> **no** pongas esa variable: build normal → log de errores limpio.

### 5C. Arrancar en PM2 — ⚠️ gotcha del .env
Next **no siempre carga `.env`** bajo PM2. Arranca **exportando el `.env`** al entorno
(en **Git Bash**), para que el proceso tenga `DATABASE_URL` etc.:
```bash
cd /c/Software/procovar-delivery
set -a; . ./.env; set +a
pm2 start ecosystem.config.js     # procovar-delivery (3002) + procovar-delivery-sync (worker)
pm2 save                          # <- imprescindible
```
> ⚠️ **Deben quedar DOS procesos arriba:** `procovar-delivery` (la web) **y**
> `procovar-delivery-sync` (el worker de la cola). **Sin el worker, los pedidos se
> encolan pero NADIE los procesa** y el `costoDomicilio` nunca se calcula. Verifica con
> `pm2 list` que **ambos** están `online`; si falta el worker:
> `pm2 start ecosystem.config.js --only procovar-delivery-sync && pm2 save`.
>
> 🏷️ **`SUCURSAL_CODIGO`** (en el `.env`): en el modelo **local por-sucursal** = el
> código de ESTA sucursal (ej. `"CAM"`), así el worker solo jala SUS pedidos. En el
> modelo **centralizado en la nube** va **vacío** (`""`) para procesar todas → ver
> **[DEPLOY-CLOUD.md](DEPLOY-CLOUD.md)**.

### 5D. Configuración inicial (una vez)
```powershell
# 1) Usuario admin
Invoke-RestMethod -Method Post http://localhost:3002/api/auth/register -ContentType application/json `
  -Body '{"name":"Admin","email":"admin@procovar.local","password":"cambia-esto"}'
# 2) Login -> token
$L = Invoke-RestMethod -Method Post http://localhost:3002/api/auth/login -ContentType application/json `
  -Body '{"email":"admin@procovar.local","password":"cambia-esto"}'; $T = $L.token
# 3) Sucursal-origen con externalId=XXX y las COORDS REALES del almacén (punto de partida)
Invoke-RestMethod -Method Post http://localhost:3002/api/branches -Headers @{Authorization="Bearer $T"} `
  -ContentType application/json -Body '{"name":"Tu Sucursal","externalId":"XXX","lat":<LAT_ALMACEN>,"lng":<LNG_ALMACEN>,"areaKm2":50}'
# 4) Fórmula del domicilio (ajusta tu tarifa)
Invoke-RestMethod -Method Put http://localhost:3002/api/settings -Headers @{Authorization="Bearer $T"} `
  -ContentType application/json -Body '{"domBaseFee":50,"domCostPerKm":10,"domCostPerKg":0,"domIncludedKm":2,"domMinFee":50,"domRoundTo":5}'
```

> 🚦 **Guard de configuración:** el cálculo de domicilios **NO corre** hasta que estén
> seteados **la fórmula** (paso 4) **y** el **punto de partida** = coords del almacén
> (paso 3). Mientras falte alguno, el worker **encola pero no procesa** (los pedidos
> quedan en espera). Lo ves en la página **/sync** ("cálculo en espera — falta
> configuración"). Puedes cambiar el punto de partida cuando quieras en **Sucursales**;
> **al cambiar fórmula o punto, solo los pedidos NUEVOS usan los valores nuevos** (los ya
> calculados se mantienen).

---

## 6 — VPN WireGuard (warehouse)

Cada server tiene su túnel propio y sube solo como servicio. Verifica que llega al warehouse:
```powershell
Test-Connection 10.188.2.2 -Count 2
(Test-NetConnection 10.188.2.2 -Port 3001).TcpTestSucceeded    # debe ser True
```
Probar los pesos con el token:
```powershell
Invoke-RestMethod -Headers @{Authorization="Bearer <token>"} `
  http://10.188.2.2:3001/api/external-api/products/weights | Select-Object -First 3
```
> Si no hay túnel, importa el `.conf` de la sucursal en la app WireGuard y actívalo, o como
> servicio: `& "C:\Program Files\WireGuard\wireguard.exe" /installtunnelservice <ruta.conf>`.
> **Ojo:** no actives dos túneles de la misma red 10.188.2.0/24 a la vez (chocan).

---

## 7 — analitics (columna "Pedidos")

Define en el backend de analitics y reinícialo:
```
PEDIDO_API_URL=http://localhost:8400
SERVICE_API_KEY=una-clave-larga-compartida
```
Instala la dep nueva si aplica: `pip install -r app/backend/requirements.txt` (agrega `httpx`).

---

## 8 — Persistir en PM2 (¡importante!)

```powershell
pm2 save          # guarda la lista actual de procesos
pm2 startup       # (una vez) para que PM2 suba al reiniciar Windows
```
> ⚠️ **Gotcha:** si añades procesos y **no** haces `pm2 save`, un reinicio del daemon
> (o `pm2 resurrect`) **borra** los procesos no guardados. Haz `pm2 save` cada vez.

---

## 9 — Verificar de punta a punta

```powershell
# PEDIDO api vivo
(Invoke-WebRequest http://localhost:8400/ -UseBasicParsing -SkipHttpErrorCheck).StatusCode
# delivery vivo
(Invoke-WebRequest http://localhost:3002/login -UseBasicParsing).StatusCode
# Cola en vivo: abre en el navegador  http://localhost:3002/sync
# Pedidos en tiempo real: la lista de pedidos de PEDIDO (5000) agrega los nuevos sin refrescar.
```
El worker procesa los pedidos **de a uno, suave**, y escribe el `costoDomicilio` en cada
pedido. En la card del pedido (PEDIDO) se ve el costo (copiable) y el flag
**Calculado / Sin calcular**.

---

## Novedades de esta versión (qué se agregó)

- **PEDIDO en PostgreSQL** (antes SQLite). Migración sin pérdida con `export-all` / `import-all`.
- **Costo de domicilio en la card del pedido**: valor copiable + chip `Domicilio: $X` /
  `sin calcular` en la lista.
- **Cola + SSE de domicilios** (delivery): worker que procesa **por pedido, suave** (no en
  bulk), tabla `SyncJob` como "redis sin redis", página **/sync** en vivo por SSE.
- **Pedidos en tiempo real**: la lista de pedidos de PEDIDO agrega los nuevos por SSE, sin
  refrescar.
- **Guard de configuración**: no se calcula hasta setear **fórmula** + **punto de partida**;
  al cambiarlos, **solo los nuevos** usan los valores nuevos.

## Errores/gotchas encontrados (para las otras sucursales)

1. **Prisma 7 (PEDIDO)**: los scripts `.mjs` (`import-geolocalizacion`, `export-all`,
   `import-all`) necesitan **driver adapter** (`prisma-node-client.mjs`); `new PrismaClient()`
   pelado ya no funciona.
2. **`config.json`** debe apuntar al **sucursalId REAL** de ESTA base (no copiado de otra
   instalación), o la integración devuelve 0 pedidos.
3. **Backfill de `sucursalId`** en pedidos/clientes viejos ANTES de importar geo.
4. **PostgreSQL por winget** deja clave `postgres`; cámbiala con `ALTER USER`.
5. **Next + PM2 no carga `.env`**: exporta el `.env` antes de `pm2 start`
   (`set -a; . ./.env; set +a`).
6. **`pm2 save`** tras añadir procesos (si no, un resurrect los borra).
7. **delivery no va en SQLite** (usa `Json`): se queda en Postgres.
8. **PEDIDO puertos**: api = 8400, frontend = 5000 (el 5000 es la web que se ve).
9. **Warehouse**: solo por VPN (`10.188.2.2:3001`); ~muchos productos sin `weightKg` (van con
   peso 0; el precio por distancia igual se calcula).
10. **El worker `procovar-delivery-sync` debe estar `online`** (es un proceso PM2 aparte de
    la web). Si se cae o no se guardó con `pm2 save`, la cola crece pero nada se procesa.
11. **Warning de standalone**: si en `delivery-error.log` ves *"next start does not work with
    output: standalone"*, es porque el build salió standalone bajo PM2. Rebuild **sin**
    `BUILD_STANDALONE` (`npm run build`) y reinicia. Es cosmético (la app funciona igual),
    pero ensucia el log y tapa errores reales.

---

## Modelo LOCAL vs. CENTRALIZADO (nube)

Esta guía cubre el modelo **local por-sucursal**: **un servidor = una sucursal**, aislado,
en Windows + PM2. Cada sucursal corre su propia copia y solo ve sus datos.

Para **producción centralizada** (todas las sucursales en un mismo lugar, en un VPS, con
**Docker + Redis + colas** y actualización en vivo por SSE sobre Redis), usa la guía
**[DEPLOY-CLOUD.md](DEPLOY-CLOUD.md)**. Ese modelo es el que aguanta **varias sucursales
metiendo datos a la vez** sin colapsar el servidor.
