-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalPages" INTEGER NOT NULL,
    "completedPages" INTEGER NOT NULL DEFAULT 0,
    "currentPageId" TEXT,
    "currentStep" TEXT,
    "errors" TEXT[],
    "pageIds" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'cs',
    "mode" TEXT NOT NULL DEFAULT 'transcribe+translate',
    "collectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingJob_userId_status_idx" ON "ProcessingJob"("userId", "status");

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
