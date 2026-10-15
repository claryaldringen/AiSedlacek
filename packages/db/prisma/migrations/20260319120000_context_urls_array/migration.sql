-- AlterTable: Convert contextUrl (single) to contextUrls (array)
ALTER TABLE "Collection" ADD COLUMN "contextUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Migrate existing data
UPDATE "Collection" SET "contextUrls" = ARRAY["contextUrl"] WHERE "contextUrl" IS NOT NULL;

-- Drop old column
ALTER TABLE "Collection" DROP COLUMN "contextUrl";
