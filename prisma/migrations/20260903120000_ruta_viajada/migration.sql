-- En qué ruta VIAJÓ un pedido, aparte de en cuál va AHORA.
--
-- Son dos preguntas distintas y hasta ahora las contestaba el mismo campo:
--   `routeId`      -> está ocupado por esta ruta, no se puede meter en otra.
--   `ultimaRutaId` -> viajó en este camión. De aquí sale el post-despacho.
--
-- Hacía falta para poder soltar un DEVUELTO de la ruta —volvió al almacén, así que tiene
-- que poder repartirse otra vez— sin borrarlo de la hoja de cierre del camión que lo
-- llevó.
ALTER TABLE "Order" ADD COLUMN "ultimaRutaId" TEXT;

-- Los que ya están en una ruta viajaron en ella: se rellena para no perder el histórico
-- de lo que ya se repartió. Sin esto, las rutas de estos días saldrían vacías en su hoja.
UPDATE "Order" SET "ultimaRutaId" = "routeId" WHERE "routeId" IS NOT NULL;

CREATE INDEX "Order_ultimaRutaId_idx" ON "Order"("ultimaRutaId");

-- Si la ruta se borra, el pedido no se borra: pierde las dos referencias y vuelve a la
-- lista. Es lo mismo que ya hacía `routeId`.
ALTER TABLE "Order" ADD CONSTRAINT "Order_ultimaRutaId_fkey"
  FOREIGN KEY ("ultimaRutaId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
