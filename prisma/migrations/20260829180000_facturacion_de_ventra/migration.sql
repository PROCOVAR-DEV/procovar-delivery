-- La FACTURACIÓN de Ventra: lo que de verdad se vendió.
--
-- El pedido y la factura no siempre coinciden —el cliente cambia lo que pidió— y la ruta
-- hay que armarla con lo facturado: es lo que va en el camión y lo que se cobra.
CREATE TABLE IF NOT EXISTS "VentaFacturada" (
  "id" TEXT NOT NULL,
  "ventraId" TEXT NOT NULL,
  "sucursalCodigo" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "operNumber" TEXT NOT NULL,
  "clienteCodigo" TEXT,
  "clienteNombre" TEXT NOT NULL,
  "productoCodigo" TEXT,
  "productoNombre" TEXT NOT NULL,
  "cantidad" DOUBLE PRECISION NOT NULL,
  "precioUsd" DOUBLE PRECISION,
  "traidoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VentaFacturada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VentaFacturada_ventraId_key" ON "VentaFacturada"("ventraId");
CREATE INDEX IF NOT EXISTS "VentaFacturada_sucursalCodigo_fecha_idx" ON "VentaFacturada"("sucursalCodigo", "fecha");
CREATE INDEX IF NOT EXISTS "VentaFacturada_clienteNombre_idx" ON "VentaFacturada"("clienteNombre");
CREATE INDEX IF NOT EXISTS "VentaFacturada_operNumber_idx" ON "VentaFacturada"("operNumber");

-- Y en el pedido, cómo quedó frente a su factura.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "facturaEstado" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "facturaNumero" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "facturaAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Order_facturaEstado_idx" ON "Order"("facturaEstado");
