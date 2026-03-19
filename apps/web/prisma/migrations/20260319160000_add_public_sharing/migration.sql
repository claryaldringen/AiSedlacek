-- AlterTable: add isPublic and slug to Collection
ALTER TABLE "Collection" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Collection" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- AlterTable: add isPublic and slug to Page
ALTER TABLE "Page" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Page" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateTable: PublicSlug
CREATE TABLE "PublicSlug" (
    "slug" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicSlug_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex: unique targetId in PublicSlug
CREATE UNIQUE INDEX "PublicSlug_targetId_key" ON "PublicSlug"("targetId");
