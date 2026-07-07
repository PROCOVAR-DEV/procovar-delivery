# Diseño: Cotización de Envío a Domicilio Individual (API para PEDIDO)

**Fecha:** 2026-06-29
**Proyecto:** ProCovar Delivery
**Enfoque:** Nuevo modelo de precio por pedido individual + endpoint de integración con la app PEDIDO. El **flujo** de rutas (agrupar pedidos, armar la ruta) no se reestructura, pero `computeRoutePricing` **deja de fijar precio**: pasa a ser solo **optimizador de ruta**.

---

## Contexto y modelo de negocio

Hay **un solo modelo de precio** (envío a domicilio individual) y, por separado, un **cálculo de ruta óptima** que **ya NO fija precios**:

1. **Cálculo de ruta óptima (lo que era el "precio de ruta").**
   `computeRoutePricing` en `pricing.ts` **ya NO calcula precio ni reparte el costo del viaje entre clientes**. Su rol pasa a ser puramente **logístico**: toma las órdenes que llegan desde PEDIDO —que **ya traen su `deliveryPrice` puesto**— y solo calcula la **ruta óptima** a partir de ellas (qué vehículo, orden de paradas). Agrupa pedidos que ya existen y ya tienen precio; no lo toca.

2. **Precio de envío a domicilio individual (el ÚNICO precio).**
   Cuando entra **un pedido** desde la app PEDIDO, se calcula **su propio precio** según la distancia **sucursal → punto de entrega** de ese pedido, como un **viaje dedicado** (el cliente no comparte el viaje con nadie). Ese precio es el que se le cobra al cliente por el domicilio.

**Regla clave — secuencia:**

1. PEDIDO manda las órdenes **sin** precio de domicilio (el campo llega vacío).
2. Delivery, con el endpoint de cálculo individual, le calcula a **cada** pedido su precio de domicilio, lo **escribe de vuelta** en PEDIDO y guarda su copia local.
3. Esas órdenes quedan **actualizadas y visibles en delivery**, ya con lo que hay que **entregar** y lo que hay que **cobrarle al cliente**.
4. **Recién entonces** se arma la ruta: la creación de rutas **ya NO fija ningún precio**, solo **agrupa esas órdenes ya cotizadas y calcula el recorrido óptimo**.

### Propiedad de los datos (IMPORTANTE)

**PEDIDO es el dueño / sistema de registro de TODO.** Cuando entra un pedido se guarda **en PEDIDO** con todos sus campos **+ un campo vacío `precioPorDomicilio`**. **procovar-delivery solo RELLENA ese campo.** Delivery NO es el dueño de los pedidos: es el **procesador** de precios.

Cada pedido lleva su **`sucursalId`**, con el que delivery resuelve el **punto de partida** (la sucursal-origen con coordenadas, vía `Branch.externalId = sucursalId`). Con eso, más la **geo del cliente** y el **peso**, calcula el precio.

### Tres sistemas que se comunican

Para que todo funcione junto, la integración cruza **tres APIs**. El objetivo es dejar delivery **listo para pushear** y que las tres se comuniquen sin más ajustes:

1. **PEDIDO** — dueño de los pedidos. Manda cada pedido (con `sucursalId`, productos, geo del cliente) y recibe de vuelta el `precioPorDomicilio`.
2. **procovar-delivery** — procesador. Calcula el precio de domicilio y optimiza rutas. No es dueño de pedidos ni de productos: se alimenta de los otros dos.
3. **Data Warehouse** — dueño de los **productos** (pesos) y **más datos** de los que delivery puede alimentarse. Delivery lo consulta para resolver el **peso** de cada pedido a partir de sus productos.

### Flujo end-to-end (modelo PULL — objetivo)

```
PEDIDO  ── guarda el pedido con todos sus campos + precioPorDomicilio = vacío
   ▲                                                        │
   │ (4) PATCH precioPorDomicilio                           │ (1) GET /pedidos  (delivery jala)
   │                                                        ▼
DELIVERY ── (2) por cada pedido: resuelve sucursalId → Branch (origen)
            (3) distancia = haversine(sucursal → cliente); precio = fórmula de domicilio
            ── mantiene copia de trabajo local para armar rutas
```

Delivery extrae los pedidos desde la API de PEDIDO, calcula el precio de domicilio de cada uno y lo **escribe de vuelta** en PEDIDO. Ese precio alimenta el **sistema contable** de PEDIDO.

### Núcleo agnóstico a la dirección (ya construido)

La parte de cálculo es la misma sin importar quién llama a quién: la fórmula `calculateHomeDeliveryPrice` + la resolución `sucursalId → Branch`. El endpoint `POST /api/quote` (abajo) expone ese cálculo como servicio (modelo push: PEDIDO/worker llama, recibe el precio). Cuando el contrato de la API de PEDIDO esté definido, se añade el cliente/worker pull (GET pedidos + PATCH precio) que **reutiliza el mismo cálculo**.

---

## Fórmula de envío a domicilio individual

Viaje dedicado de ida y vuelta, con radio incluido, carga mínima y redondeo. Todos los parámetros son configurables (con default 0, lo que la reduce a la forma simple hasta que se configuren).

```
distancia    = haversine(sucursal, cliente)            // km, línea recta (instantáneo)
kmCobrables  = max(0, distancia - domIncludedKm)        // primeros km incluidos en la base
precio       = domBaseFee
             + 2 · kmCobrables · domCostPerKm           // ×2 = ida y vuelta
             + pesoTotal · domCostPerKg
precio       = max(precio, domMinFee)                   // nunca por debajo del mínimo
si domRoundTo > 0:  precio = ceil(precio / domRoundTo) · domRoundTo   // redondeo hacia arriba
```

Este es el único precio. La parte de rutas ya no calcula precio: solo arma el recorrido óptimo con estas órdenes ya cotizadas. Aquí el cliente paga el viaje completo.

---

## Cambios al schema de Prisma

### `Branch` — mapeo con la sucursal de PEDIDO
```prisma
externalId String? @unique   // = id de la sucursal en la app PEDIDO
orders     Order[]           // back-relation (nuevo)
```
PEDIDO no almacena coordenadas de sus sucursales; delivery es el dueño de las coordenadas. PEDIDO solo manda el id de su sucursal y delivery lo resuelve a `Branch` (lat/lng).

### `Settings` — parámetros propios del domicilio (separados de los de ruta)
```prisma
domBaseFee    Float @default(0)
domCostPerKm  Float @default(0)
domCostPerKg  Float @default(0)
domIncludedKm Float @default(0)
domMinFee     Float @default(0)
domRoundTo    Float @default(0)   // 0 = sin redondeo
```

### `Order` — precio individual persistido + procedencia
```prisma
deliveryPrice      Float?    // precio del domicilio para el cliente (fuente de verdad contable)
deliveryDistanceKm Float?    // distancia sucursal → cliente usada en el cálculo
branchId           String?   // sucursal de origen
branch             Branch?   @relation(fields: [branchId], references: [id])
source             String?   // "pedido" (vino de la app PEDIDO) | null (manual)
externalId         String?   // id/folio del pedido en PEDIDO (idempotencia)
```

`deliveryPrice` es **independiente** de `price` (el precio de reparto de la ruta). El flujo de rutas NO lo toca, así que el precio que ve el cliente / contabilidad nunca se sobrescribe.

---

## Lógica de pricing (`src/lib/pricing.ts`)

Nueva función pura `calculateHomeDeliveryPrice(distanceKm, weightKg, config)` que implementa la fórmula de arriba y devuelve `{ distanceKm, chargeableKm, price, breakdown }`. No cambia ninguna función existente.

---

## API

### Nuevo endpoint `POST /api/quote`  (integración PEDIDO ↔ delivery)

**Auth:** header `x-api-key: <SERVICE_API_KEY>` (servidor-a-servidor, sin JWT de usuario).

**Body:**
```jsonc
{
  "sucursalExternalId": "<id de la sucursal en PEDIDO>",  // requerido
  "customerName": "Juan Pérez",
  "address": "Calle 5 #123",
  "lat": 23.11, "lng": -82.36,                            // geolocalización del cliente
  "weight": 12.5,                                          // o items[]
  "items": [{ "description": "Caja A", "weight": 3, "quantity": 2 }],
  "operationNumber": "PED-00045",                          // folio en PEDIDO
  "externalId": "PED-00045",                               // idempotencia (opcional)
  "preview": false                                         // true = solo cotiza, no guarda
}
```

**Respuesta `200`:**
```jsonc
{
  "orderId": "ckxyz...",        // null si preview
  "price": 350,                  // precio del domicilio (lo que cobra/contabiliza PEDIDO)
  "currency": "USD",
  "distanceKm": 8.2,
  "chargeableKm": 6.2,
  "weightKg": 12.5,
  "breakdown": { "base": 50, "distance": 186, "weight": 6.25, "beforeMin": 242.25, "beforeRound": 242.25 },
  "branch": { "id": "...", "name": "Sucursal Centro" }
}
```

- `preview: true` → solo calcula y devuelve el precio (para mostrarlo mientras se llena el pedido).
- `preview` ausente/false → además **guarda** el `Order` (status `pending`, sin ruta) con `deliveryPrice`, `deliveryDistanceKm`, `branchId`, `source: "pedido"`, `externalId`. Si ya existe un Order con ese `externalId`+`source`, lo **actualiza** (idempotente).
- El `Order` se crea bajo el dueño de la sucursal (`branch.creatorId`), de modo que aparezca en su panel y pueda añadirse luego a una ruta.

Errores: `401` (api key inválida), `400` (faltan campos / coords), `404` (sucursal no mapeada en delivery).

### `GET/PUT /api/settings`
Persisten también los 6 campos `dom*`. (UI en la pantalla de Settings.)

---

## UI

### Settings (`/settings`)
Nueva tarjeta **"Envío a domicilio (individual)"** con los 6 parámetros `dom*` y una mini-fórmula de ejemplo. No toca la tarjeta de precios de ruta existente.

### Branches (`/branches`)
(Pendiente / futuro) campo opcional `externalId` para enlazar cada sucursal con su equivalente en PEDIDO. Se puede setear por API/SQL inicialmente.

---

## Integración con PEDIDO (lado a construir DESPUÉS — esperando a Parranda)

Modelo **pull**: delivery jala los pedidos de PEDIDO, calcula y devuelve el precio.

- PEDIDO guarda cada pedido con un campo `precioPorDomicilio` (vacío al inicio) y expone su `sucursalId`.
- Delivery: worker/cliente que hace `GET /pedidos` contra la API de PEDIDO → por cada pedido resuelve `sucursalId → Branch`, calcula con `calculateHomeDeliveryPrice` → `PATCH` del `precioPorDomicilio` de vuelta en PEDIDO.
- Delivery mantiene copia de trabajo local de los pedidos para armar rutas.
- Variable de entorno compartida: `SERVICE_API_KEY`.

### Datos que faltan de PEDIDO (el usuario los dará más adelante)

- Contrato de la API de PEDIDO: endpoint(s) para listar pedidos y para escribir `precioPorDomicilio`, y la forma (shape) de cada pedido (campos, `sucursalId`, folio, qué productos incluye).
- **Geolocalización del cliente (lat/lng) — ÚNICO BLOQUEANTE de PEDIDO.** Del lado de PEDIDO ya está **todo lo demás**; lo único que falta es la **geo**, que la aporta Parranda. Es la que dispara todo el lazo: PEDIDO manda el pedido **con geo** → delivery calcula el precio individual → lo **escribe de vuelta** → el pedido **queda con ese dato para siempre**. En cuanto llegue la geo, el lazo PEDIDO↔delivery se cierra.
- **Peso / productos:** PEDIDO **no** manda el peso. Delivery lo resuelve consultando el **Data Warehouse** (tercera API, ver abajo): cruza los productos del pedido con el catálogo del warehouse para obtener el peso que alimenta el cálculo de domicilio.
- Autenticación de PEDIDO (cómo se autentica delivery contra PEDIDO).
- Si el cálculo es por evento (al crear el pedido) y/o por lote (reconciliación periódica).
- Mapeo definitivo `sucursalId` (PEDIDO) ↔ `Branch.externalId` (delivery).

### Datos que faltan del Data Warehouse

- Contrato de la API del warehouse: endpoint(s) para consultar productos y su **peso**, y la forma en que el pedido referencia sus productos (ids/SKU) para poder cruzarlos.
- Autenticación contra el warehouse (cómo se autentica delivery).
- Qué **otros datos** del warehouse conviene consumir además del peso.

---

## Alcance explícitamente excluido (por ahora)

- No se modifica PEDIDO (esperando a Parranda).
- El **flujo** de rutas (agrupar pedidos, armar la ruta) no se reestructura. Lo que **sí** cambia: `computeRoutePricing` deja de fijar precio y queda como **optimizador de ruta**; el precio ya no sale de ahí, sino del cálculo de domicilio individual.
- No se cambia el sistema de auth de usuarios (se añade solo auth por API key de servicio para `/api/quote`).
- No se migran datos existentes (columnas nuevas nullable / con default).

---

## Orden de implementación

1. Schema + migración Prisma (`Branch.externalId`, `Settings.dom*`, `Order.deliveryPrice/...`)
2. `calculateHomeDeliveryPrice` en `pricing.ts`
3. `lib/serviceAuth.ts` (validación `x-api-key`)
4. `POST /api/quote`
5. Persistencia de `dom*` en `/api/settings` + UI en Settings
6. `.env.example` con `SERVICE_API_KEY`
