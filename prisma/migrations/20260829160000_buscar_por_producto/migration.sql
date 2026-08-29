-- Los nombres de los productos, en texto, para poder BUSCAR por ellos.
--
-- Dentro del JSON de `items` no se puede buscar «malta» sin leerse los cincuenta mil
-- pedidos. Se copia el nombre a una columna y se rellena con lo que ya hay guardado.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "productosTexto" TEXT;

UPDATE "Order" o
SET "productosTexto" = sub.txt
FROM (
  SELECT o2.id,
         string_agg(DISTINCT coalesce(it->>'name', it->>'description', ''), ' · ') AS txt
    FROM "Order" o2,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(o2.items::jsonb) = 'array' THEN o2.items::jsonb ELSE '[]'::jsonb END
         ) AS it
   GROUP BY o2.id
) AS sub
WHERE o.id = sub.id AND o."productosTexto" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_productosTexto_idx" ON "Order"("productosTexto");
