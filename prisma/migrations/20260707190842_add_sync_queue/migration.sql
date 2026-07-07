-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "folio" TEXT,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cost" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "weightsSource" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_externalId_key" ON "SyncJob"("externalId");

-- CreateIndex
CREATE INDEX "SyncJob_status_createdAt_idx" ON "SyncJob"("status", "createdAt");
