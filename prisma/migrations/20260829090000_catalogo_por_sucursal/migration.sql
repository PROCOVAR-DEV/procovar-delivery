-- El catálogo pasa a ser POR SUCURSAL y a llenarse solo desde Ventra (vía PEDIDO).
--
-- En Ventra el precio y las existencias varían por sucursal; el peso no. El catálogo
-- único ofrecía en Camagüey lo que sólo hay en La Habana, y al precio de La Habana.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sucursalCodigo" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stock" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "traidoAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Lo que había antes se queda: es de nadie (sucursalCodigo NULL) y el índice único lo
-- permite porque en Postgres dos NULL no chocan.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_sucursalCodigo_sku_key" ON "Product"("sucursalCodigo", "sku");
CREATE INDEX IF NOT EXISTS "Product_sucursalCodigo_idx" ON "Product"("sucursalCodigo");
CREATE INDEX IF NOT EXISTS "Product_name_idx" ON "Product"("name");
