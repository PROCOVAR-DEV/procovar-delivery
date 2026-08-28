-- El código y el vendedor del cliente, que ya venían dentro de `meta`.
--
-- Estando ahí dentro no se podía filtrar sin leer y descartar los siete mil clientes en
-- cada consulta. Se sacan a columnas y se rellenan con lo que ya hay guardado.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "codigo" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "vendedor" TEXT;

UPDATE "Customer"
SET "codigo" = NULLIF(meta->>'codigo', ''),
    "vendedor" = NULLIF(meta->'vendedor'->>'nombre', '')
WHERE meta IS NOT NULL AND ("codigo" IS NULL OR "vendedor" IS NULL);

CREATE INDEX IF NOT EXISTS "Customer_vendedor_idx" ON "Customer"("vendedor");
CREATE INDEX IF NOT EXISTS "Customer_codigo_idx" ON "Customer"("codigo");
