-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "originConfigured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "domConfigured" BOOLEAN NOT NULL DEFAULT false;
