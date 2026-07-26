-- Alinea Customer al patrón de Order: externalId no-único + source + meta + índice.
-- DropIndex
DROP INDEX "Customer_externalId_key";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "externalId" DROP NOT NULL,
    ADD COLUMN "source" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "meta" JSONB,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Customer_source_externalId_idx" ON "Customer"("source", "externalId");
