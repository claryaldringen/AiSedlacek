-- DropIndex
DROP INDEX "Document_hash_key";

-- CreateIndex
CREATE INDEX "Document_hash_idx" ON "Document"("hash");
