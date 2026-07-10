-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "domTipoCambio" DOUBLE PRECISION NOT NULL DEFAULT 700;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "costoKmUsd" DOUBLE PRECISION,
ADD COLUMN     "usarParaDomicilio" BOOLEAN NOT NULL DEFAULT false;
