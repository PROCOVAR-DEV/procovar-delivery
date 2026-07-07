-- Branch: mapeo con la sucursal de PEDIDO
ALTER TABLE "Branch" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "Branch_externalId_key" ON "Branch"("externalId");

-- Settings: parámetros del envío a domicilio individual
ALTER TABLE "Settings" ADD COLUMN "domBaseFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "domCostPerKm" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "domCostPerKg" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "domIncludedKm" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "domMinFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "domRoundTo" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Order: precio individual persistido + procedencia
ALTER TABLE "Order" ADD COLUMN "deliveryPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "deliveryDistanceKm" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Order" ADD COLUMN "source" TEXT;
ALTER TABLE "Order" ADD COLUMN "externalId" TEXT;

CREATE INDEX "Order_source_externalId_idx" ON "Order"("source", "externalId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
