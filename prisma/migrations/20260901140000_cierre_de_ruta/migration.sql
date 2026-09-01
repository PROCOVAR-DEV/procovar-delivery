-- Cómo acabó cada parada cuando el camión vuelve.
--
-- De aquí sale el post-despacho: lo que tiene que quedar en el camión es lo que NO se
-- entregó. Sin esto, lo que baja del camión se cuadra de memoria.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "resultado" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "resultadoAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "resultadoNota" TEXT;
CREATE INDEX IF NOT EXISTS "Order_resultado_idx" ON "Order"("resultado");
