-- El catálogo COMPLETO de pedidos, con lo que hace falta para poder filtrarlo.
--
-- Delivery tenía un recorte: los últimos días, y sólo los que llevan domicilio. Pero una
-- ruta se arma también con pedidos ya completados, y en PEDIDO hay 56.208 pedidos —de los
-- que 51.871 están archivados—. Verlos todos sin poder distinguirlos es no verlos.
--
-- Estas columnas existen para FILTRAR en el servidor. Estaban dentro de `meta`, el JSON
-- con el pedido entero, así que filtrar por municipio o por vendedor obligaba a leer y
-- descartar cada pedido completo: con 50.000 filas eso no es un filtro, es traerse la
-- base a memoria en cada consulta.
ALTER TABLE "Order" ADD COLUMN "pedidoUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "estado" TEXT;
ALTER TABLE "Order" ADD COLUMN "archivado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "fechaComprometida" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "requiereDomicilio" BOOLEAN;
ALTER TABLE "Order" ADD COLUMN "pedidoCosto" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "municipio" TEXT;
ALTER TABLE "Order" ADD COLUMN "vendedor" TEXT;
ALTER TABLE "Order" ADD COLUMN "sucursalCodigo" TEXT;

CREATE INDEX "Order_pedidoUpdatedAt_idx" ON "Order"("pedidoUpdatedAt");
CREATE INDEX "Order_estado_idx" ON "Order"("estado");
CREATE INDEX "Order_archivado_idx" ON "Order"("archivado");
CREATE INDEX "Order_municipio_idx" ON "Order"("municipio");
CREATE INDEX "Order_vendedor_idx" ON "Order"("vendedor");
CREATE INDEX "Order_requiereDomicilio_idx" ON "Order"("requiereDomicilio");

-- Los pedidos que YA están en el espejo tienen todo esto dentro de `meta`. Se rellena de
-- ahí en vez de dejarlos en null esperando a que el espejo vuelva a pasar por ellos: son
-- 12.625 y hasta entonces no aparecerían en ningún filtro — que es lo mismo que no estar.
--
-- La fecha del pedido también: `meta->>'fecha'` es la de PEDIDO, y `createdAt` la de
-- copiado. Es justo la diferencia que dejaba el filtro por día devolviendo cero.
UPDATE "Order" SET
  "orderDate"         = COALESCE("orderDate", NULLIF(meta->>'fecha', '')::timestamp),
  "pedidoUpdatedAt"   = NULLIF(meta->>'updatedAt', '')::timestamp,
  "estado"            = NULLIF(meta->>'estado', ''),
  "archivado"         = COALESCE((meta->>'archivado')::boolean, false),
  "fechaComprometida" = NULLIF(meta->>'fechaComprometida', '')::timestamp,
  "requiereDomicilio" = (meta->>'requiereDomicilio')::boolean,
  "pedidoCosto"       = NULLIF(meta->>'costoDomicilio', '')::double precision,
  "municipio"         = NULLIF(meta->'cliente'->>'municipio', ''),
  "vendedor"          = COALESCE(NULLIF(meta->'vendedor'->>'nombre', ''), NULLIF(meta->'vendedor'->>'codigo', '')),
  "sucursalCodigo"    = NULLIF(meta->>'sucursalCodigo', '')
WHERE source = 'pedido' AND meta IS NOT NULL;
