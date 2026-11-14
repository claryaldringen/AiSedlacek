-- Skutečně odečtené kredity u dokumentu, překladu a v ledgeru (BIL-11).
-- Jen nové nullable sloupce a index, existující data se nemění (staré záznamy zůstanou NULL).
-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "chargedCredits" INTEGER;

-- AlterTable
ALTER TABLE "TokenTransaction" ADD COLUMN     "collectionId" TEXT,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER;

-- AlterTable
ALTER TABLE "Translation" ADD COLUMN     "chargedCredits" INTEGER;

-- CreateIndex
CREATE INDEX "TokenTransaction_collectionId_idx" ON "TokenTransaction"("collectionId");

