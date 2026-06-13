-- AlterTable
ALTER TABLE "SavedOrigin" ADD COLUMN     "branchId" TEXT;

-- AddForeignKey
ALTER TABLE "SavedOrigin" ADD CONSTRAINT "SavedOrigin_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
