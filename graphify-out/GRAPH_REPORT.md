# Graph Report - /home/jose/procovar/procovar-delivery  (2026-07-26)

## Corpus Check
- 106 files · ~61,182 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 590 nodes · 1027 edges · 55 communities (36 shown, 19 thin omitted)
- Extraction: 96% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Src App Api
- Src Lib
- Package Devdependencies
- Package Dependencies
- Tsconfig Compileroptions
- Vps Docker Compose
- App Api Routes
- Dashboard
- Sync Queue
- Dashboard
- Dashboard
- I18n
- Vps Vps
- Specs 2026 06
- Dashboard Page
- Vps
- Geocode
- Local
- Specs 2026 06
- Seed Orders
- Local Local
- Vps Docker
- Dashboard Reports Page
- Dashboard Vehicles Page
- 20260604215456 Init Migration
- Dashboard Sync Page
- Layout
- Vps Vps
- Match Report
- Mapcomponent
- Sync Pedidos
- 20260629000000 Home Delivery
- Routesummarycard
- 20260613144901 Order Items
- 20260613150513 Add Branches
- 20260707195108 Add Config
- 20260710123855 Add Domicilio
- 20260710170934 Add Branch
- Seed Vehicles
- Fix Password
- Next Config
- 20260606164851 Add Currency
- 20260613154044 Add Products
- 20260613160027 Origin Branch
- 20260707030000 Add Order
- 20260707190842 Add Sync
- 20260710140841 Add Tipos
- 20260710152958 Add Factor
- 20260724150000 Add Customer
- 20260726120000 Customer Like

## God Nodes (most connected - your core abstractions)
1. `getUserFromRequest()` - 65 edges
2. `useAppStore` - 43 edges
3. `useT()` - 34 edges
4. `resolveScope()` - 24 edges
5. `scopeWhere()` - 18 edges
6. `useCurrency()` - 18 edges
7. `haversineDistance()` - 16 edges
8. `compilerOptions` - 16 edges
9. `usePagedList()` - 13 edges
10. `cycle()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `CustomerPicker (routes/page.tsx PedidoForm)` --semantically_similar_to--> `/api/origins y /api/origins/[id]`  [INFERRED] [semantically similar]
  HANDOFF.md → docs/superpowers/specs/2026-06-01-delivery-pricing-routes-design.md
- `Cola domicilios (BullMQ, reemplaza SyncJob)` --semantically_similar_to--> `Cola durable procovar-delivery:in:orders`  [INFERRED] [semantically similar]
  deploy/vps/DEPLOY-VPS.md → HANDOFF.md
- `Gotcha: standalone solo para Docker (warning en PM2)` --semantically_similar_to--> `BUILD_STANDALONE=1 obligatorio en el deploy del VPS`  [INFERRED] [semantically similar]
  deploy/local/DEPLOY-LOCAL.md → HANDOFF.md
- `useCurrency() conversión USD/CUP` --conceptually_related_to--> `Order.deliveryPrice / deliveryDistanceKm / source / externalId`  [INFERRED]
  HANDOFF.md → docs/superpowers/specs/2026-06-29-home-delivery-quote-api.md
- `Bloqueo de datos: 0 de 115 clientes con geo` --semantically_similar_to--> `Geolocalización del cliente: único bloqueante de PEDIDO`  [INFERRED] [semantically similar]
  HANDOFF.md → docs/superpowers/specs/2026-06-29-home-delivery-quote-api.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cutover event-driven PEDIDO to DELIVERY (sin polling)** — handoff_enqueuedeliveryorders, handoff_in_orders_queue, handoff_sync_queue_mjs, handoff_delivery_events_flag, handoff_safety_poll_ms, handoff_procovar_redis_container [EXTRACTED 1.00]
- **Stack de producción VPS (3 apps + postgres + redis + caddy)** — deploy_vps_docker_compose_postgres, deploy_vps_docker_compose_redis, deploy_vps_docker_compose_pedido_api, deploy_vps_docker_compose_pedido_front, deploy_vps_docker_compose_delivery, deploy_vps_docker_compose_delivery_sync, deploy_vps_docker_compose_analitics_api, deploy_vps_docker_compose_analitics_front, deploy_vps_docker_compose_caddy [EXTRACTED 1.00]
- **Flujo de cotización de domicilio individual** — docs_superpowers_specs_2026_06_29_home_delivery_quote_api_post_api_quote, docs_superpowers_specs_2026_06_29_home_delivery_quote_api_calculatehomedeliveryprice, docs_superpowers_specs_2026_06_29_home_delivery_quote_api_branch_externalid, docs_superpowers_specs_2026_06_29_home_delivery_quote_api_settings_dom_params, docs_superpowers_specs_2026_06_29_home_delivery_quote_api_order_deliveryprice, docs_superpowers_specs_2026_06_29_home_delivery_quote_api_serviceauth [EXTRACTED 1.00]

## Communities (55 total, 19 thin omitted)

### Community 0 - "Src App Api"
Cohesion: 0.07
Nodes (54): POST(), POST(), POST(), DELETE(), PATCH(), GET(), POST(), GET() (+46 more)

### Community 1 - "Src Lib"
Cohesion: 0.06
Nodes (45): POST(), POST(), POST(), QuoteItem, weightFromItems(), BranchOrigin, buildOrderData(), computeItemsWeights() (+37 more)

### Community 2 - "Package Devdependencies"
Cohesion: 0.06
Nodes (32): autoprefixer, devDependencies, autoprefixer, postcss, prisma, tailwindcss, @types/bcryptjs, @types/jsonwebtoken (+24 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.07
Nodes (27): axios, bcryptjs, bull, @iconify/react, ioredis, jsonwebtoken, leaflet, next (+19 more)

### Community 4 - "Tsconfig Compileroptions"
Cohesion: 0.07
Nodes (26): dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+18 more)

### Community 5 - "Vps Docker Compose"
Cohesion: 0.11
Nodes (22): delivery se queda en Postgres (Prisma Json no va en SQLite), Gotcha: standalone solo para Docker (warning en PM2), Layout vps-deploy con los 3 repos hermanos, Bundle de despliegue VPS (compose, .env.example, Caddyfile, initdb), compose service: analitics-api (alias backend), compose service: analitics-front, compose service: caddy (TLS automático), compose service: delivery (Next standalone) (+14 more)

### Community 6 - "App Api Routes"
Cohesion: 0.20
Nodes (17): OrderItem, PATCH(), StopInput, weightFromItems(), createRouteFromExistingOrders(), generateRouteCode(), OrderItem, POST() (+9 more)

### Community 7 - "Dashboard"
Cohesion: 0.16
Nodes (14): DashboardPage(), MapComponent, OrderItem, OrderRow, OrdersPage(), RoutesPage(), Branch, branchLabel() (+6 more)

### Community 8 - "Sync Queue"
Cohesion: 0.21
Nodes (17): checkFormula(), cycle(), __dirname, drainQueue(), enqueueNew(), ESPERA, fetchPending(), log() (+9 more)

### Community 9 - "Dashboard"
Cohesion: 0.14
Nodes (14): Branch, BranchesPage(), emptyLoc, StartPoint, emptyForm, Product, ProductsPage(), BranchOption (+6 more)

### Community 10 - "Dashboard"
Cohesion: 0.16
Nodes (13): Customer, CustomersPage(), emptyLoc, ManualCustomerForm(), DashboardLayout(), Customer, CustomerPicker(), navItems (+5 more)

### Community 11 - "I18n"
Cohesion: 0.17
Nodes (13): LoginPage(), RegisterPage(), SettingsPage(), Product, ProductPicker(), Dict, dicts, en (+5 more)

### Community 12 - "Vps Vps"
Cohesion: 0.18
Nodes (13): Reverse proxy sin buffering para SSE (flush_interval -1), Cola geo-import, Cola import-csv (POST /orders/bulk encola), src/worker.ts (Worker BullMQ import-csv), Refactor a src/lib/importCore.ts (endpoint y worker comparten lógica), src/lib/queues.ts (BullMQ Queue definitions), SSE sobre Redis Pub/Sub (orders:new, sin polling), src/lib/redis.ts (conexión IORedis + pub/sub) (+5 more)

### Community 13 - "Specs 2026 06"
Cohesion: 0.18
Nodes (12): calculateClientDistances(), calculateOrderPrice(), calculateRouteSegments(), Factor ×2 (viaje de regreso repartido por cliente), routeCode auto-generado (RT-YYYYMMDD-NNN), Bug crítico segmentKm (pricing.ts:12), Spec: Corrección de precios, orígenes guardados e identificación de rutas, Validación de capacidad del vehículo en PATCH /api/routes/[id] (+4 more)

### Community 14 - "Dashboard Page"
Cohesion: 0.17
Nodes (11): AvailableOrder, BranchOrigin, emptyLoc, MapComponent, OrderItem, PedidoForm(), PendingStop, Route (+3 more)

### Community 15 - "Vps"
Cohesion: 0.18
Nodes (11): Cola domicilios (BullMQ, reemplaza SyncJob), Núcleo agnóstico a la dirección (push /api/quote y pull worker comparten cálculo), DELIVERY_EVENTS feature gate, enqueueDeliveryOrders() (PEDIDO productor), Event-driven sin polling (colas in/out), Cola durable procovar-delivery:in:orders, PEDIDO GET /integration/clients (solo geolocalizados), SAFETY_POLL_MS red de seguridad lenta (+3 more)

### Community 16 - "Geocode"
Cohesion: 0.38
Nodes (9): LocationInput(), LocationInputProps, MapComponent, formatCoords(), forwardGeocode(), LatLng, parseCoordInput(), reverseGeocode() (+1 more)

### Community 17 - "Local"
Cohesion: 0.24
Nodes (10): Guard de configuración (fórmula + punto de partida), Bootstrap de fórmula domiciliaria vía PUT /api/settings, calculateHomeDeliveryPrice(), Settings dom* (domBaseFee, domCostPerKm, domIncludedKm, domMinFee, domRoundTo), Spec: Cotización de envío a domicilio individual (API para PEDIDO), useCurrency() conversión USD/CUP, Leaflet.js + OpenStreetMap (sin API key), ProCovar Delivery (Next.js 14 app) (+2 more)

### Community 18 - "Specs 2026 06"
Cohesion: 0.24
Nodes (10): Orden: backfill de sucursalId antes de importar geo, Geolocalización del cliente: único bloqueante de PEDIDO, Idempotencia por [source, externalId], Order.deliveryPrice / deliveryDistanceKm / source / externalId, PEDIDO es el dueño de los datos; delivery solo rellena precioPorDomicilio, POST /api/quote (integración PEDIDO ↔ delivery), lib/serviceAuth.ts (validación x-api-key), Mirror de clientes PEDIDO to DELIVERY (+2 more)

### Community 19 - "Seed Orders"
Cohesion: 0.20
Nodes (7): camion, deposito1, deposito2, furgon, moto, ordersData, prisma

### Community 20 - "Local Local"
Cohesion: 0.22
Nodes (9): Flujo del costo de domicilio (pull, calcular, writeback), Modelo LOCAL por sucursal (Windows + PM2), Gotcha: Next bajo PM2 no carga .env, Tabla SyncJob (redis sin redis), Data Warehouse 10.188.2.2:3001 por VPN WireGuard, Cache Redis del mapa de pesos del warehouse (fetchWeightMap), Tres sistemas que se comunican (PEDIDO, delivery, Data Warehouse), Slice 3 colas out:quote/out:writeback (diferido) (+1 more)

### Community 21 - "Vps Docker"
Cohesion: 0.22
Nodes (9): JWT_SECRET compartido vía ${JWT_SECRET} del .env de compose, /api/origins y /api/origins/[id], SavedOrigin (modelo Prisma), GET/POST /api/customers (mirror + manuales), CustomerPicker (routes/page.tsx PedidoForm), Secretos divergentes en el VPS (working-tree no commiteado), SERVICE_API_KEY compartida PEDIDO/delivery, Auth JWT (jsonwebtoken + bcryptjs) (+1 more)

### Community 22 - "Dashboard Reports Page"
Cohesion: 0.22
Nodes (8): xlsx, Order, ReportData, ReportsPage(), Tab, Vehicle, VehicleSummary, xlsx

### Community 23 - "Dashboard Vehicles Page"
Cohesion: 0.25
Nodes (8): defaultForm, getTypeIcon(), statusColors, TipoVehiculo, Vehicle, VehicleFormData, VehiclesPage(), vehicleTypes

### Community 24 - "20260604215456 Init Migration"
Cohesion: 0.57
Nodes (7): "Order", "OrderVehicle", "Route", "SavedOrigin", "Settings", "User", "Vehicle"

### Community 25 - "Dashboard Sync Page"
Cohesion: 0.29
Nodes (7): fmtTime(), JobsResponse, ORDER, Snapshot, STATUS, SyncJob, SyncPage()

### Community 26 - "Layout"
Cohesion: 0.29
Nodes (5): display, metadata, mono, sans, QueryProvider()

### Community 27 - "Vps Vps"
Cohesion: 0.29
Nodes (7): SUCURSAL_CODIGO (scoping local vs centralizado), Dos formas de despliegue (LOCAL vs VPS), Modelo CENTRALIZADO en la nube (Docker + Redis + colas), Cutover a centralizado (consolidar históricos, aislamiento por sucursal), Cola db-restore, Reglas de oro para la nube (no colapsar), Branch.externalId = sucursalId de PEDIDO

### Community 28 - "Match Report"
Cohesion: 0.60
Nodes (4): main(), NOISE, normalize(), stripAccents()

### Community 29 - "Mapcomponent"
Cohesion: 0.40
Nodes (3): MapComponentProps, MapLayer, Stop

### Community 31 - "20260629000000 Home Delivery"
Cohesion: 0.67
Nodes (3): "Branch", "Order", "Settings"

## Ambiguous Edges - Review These
- `compose service: delivery-sync (Dockerfile.worker)` → `compose service: app (delivery standalone, single-repo)`  [AMBIGUOUS]
  docker-compose.yml · relation: conceptually_related_to

## Knowledge Gaps
- **190 isolated node(s):** `prisma`, `nextConfig`, `name`, `version`, `private` (+185 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `compose service: delivery-sync (Dockerfile.worker)` and `compose service: app (delivery standalone, single-repo)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `Package Dependencies` to `Package Devdependencies`, `Dashboard Reports Page`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `ReportsPage()` connect `Dashboard Reports Page` to `Dashboard`, `I18n`, `Dashboard`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `xlsx` connect `Dashboard Reports Page` to `Package Dependencies`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `prisma`, `nextConfig`, `name` to the rest of the system?**
  _190 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Src App Api` be split into smaller, more focused modules?**
  _Cohesion score 0.06751054852320675 - nodes in this community are weakly interconnected._
- **Should `Src Lib` be split into smaller, more focused modules?**
  _Cohesion score 0.06370543541788427 - nodes in this community are weakly interconnected._