# Cómo se prueba delivery

Tres capas, y cada una atrapa cosas distintas. Las tres se corren en local, contra una
base de verdad y un navegador de verdad: nada de esto necesita producción.

```
npm test          # el cálculo, sin base ni servidor
npm run test:api  # la API contra una instancia levantada
npm run test:front # la pantalla, con un navegador de verdad
```

## 1. El cálculo — `npm test`

`tests/*.test.ts`, con `node --test`. No hace falta base ni servidor: son funciones.

Lo que cubre es de dónde sale el peso de cada línea y en qué orden — PEDIDO primero, el
catálogo propio de respaldo — y que la fecha del pedido no se confunda con la de copiado.
Es el punto donde delivery dejó de tener catálogo propio, y si se rompe **no falla nada**:
sale un peso, la ruta se planifica, y el camión va cargado por un número que no es.

## 2. La API — `npm run test:api`

Contra una instancia levantada con su Postgres detrás. Atrapa lo que no es de lógica sino
de cableado: alcance por sucursal, respuestas que se traen el mundo entero, endpoints
retirados que siguen contestando.

Levantarlo entero, de cero:

```bash
# 1. Una base para pruebas, aparte de la de trabajo
docker run -d --name delivery-test-db \
  -e POSTGRES_USER=procovar -e POSTGRES_PASSWORD=procovar -e POSTGRES_DB=procovar_test \
  -p 55432:5432 postgres:16-alpine

export DATABASE_URL="postgresql://procovar:procovar@localhost:55432/procovar_test"
export JWT_SECRET="pruebas-locales-procovar"
export BASE="http://localhost:3399"

# 2. Esquema y datos
npx prisma migrate deploy
npm run test:sembrar

# 3. La aplicación
npm run build && npx next start -p 3399 &

# 4. Las pruebas
npm run test:api
```

Los datos de `scripts/sembrar-pruebas.mjs` no son «unos cuantos pedidos»: son la forma
exacta de lo que llega de PEDIDO, incluidos los casos que rompieron algo alguna vez —
pedidos de días distintos creados todos hoy, líneas con el peso resuelto y líneas sin él,
más clientes de los que caben en una página, dos sucursales para que el alcance tenga a
quién dejar fuera.

`SERVICE_API_KEY` es opcional: sin ella se salta la prueba del lote, que es la única que
la necesita.

## 3. La pantalla — `npm run test:front`

Con Playwright, un navegador de verdad. Hace falta porque delivery es una aplicación de
cliente: el HTML que manda el servidor viene vacío y todo lo pinta el navegador después,
así que con `curl` no se comprueba **nada** de lo que se reportó — «se queda cargando»,
«sigo viendo individual», «cero pedidos en otro año».

En esta máquina el navegador de Playwright no arranca: le faltan librerías del sistema
(`libnspr4`) y ponerlas pide root. Se corre en su contenedor, que las trae:

```bash
docker run --rm --network host -v "$PWD":/app -w /app \
  -e BASE -e JWT_SECRET -e DATABASE_URL -u $(id -u):$(id -g) \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  node --test scripts/pruebas-frontend.mjs
```

La sesión se pone a mano (la cookie `token` firmada con `JWT_SECRET`) para no depender de
Accesos, que en local no está.

## 4. El espejo entero — a mano, cuando se toca la integración

Las tres capas de arriba prueban cada lado por su cuenta. Esto prueba la costura: que lo
que manda PEDIDO sea lo que delivery guarda.

Hace falta PEDIDO levantado contra su propia base de pruebas (ver
`PEDIDO/api/scripts/pruebas-integracion.mjs`, que la siembra) y delivery levantado con la
MISMA `SERVICE_API_KEY`:

```bash
DATABASE_URL="postgresql://procovar:procovar@localhost:55432/procovar_test" \
PEDIDO_API_URL="http://localhost:8499" \
DELIVERY_URL="http://localhost:3399" \
SERVICE_API_KEY="la-misma-en-los-dos" \
node sync-queue.mjs --once
```

Y se mira lo que quedó:

```sql
SELECT "operationNumber", "orderDate"::date, "createdAt"::date, weight FROM "Order" WHERE source='pedido';
```

Lo que tiene que verse:

- `orderDate` es la fecha del pedido y `createdAt` la de hoy. **Distintas.** Que sean
  iguales es el fallo que daba «cero pedidos» al filtrar por cualquier otro día.
- `weight` es la suma de los pesos que resolvió PEDIDO, con el producto duplicado y el
  vínculo a mano incluidos. Si sale 1 kg por pedido, se cayó al respaldo.
- En `items`, cada línea con `weightSource: "pedido"`. Un `"catalogo"` ahí significa que
  PEDIDO no mandó ese peso y delivery volvió a cruzarlo por su cuenta.
- Los pedidos sin domicilio y los que aún no tienen costo **no están**.

## Al terminar

```bash
docker rm -f delivery-test-db pedido-test-db
```
