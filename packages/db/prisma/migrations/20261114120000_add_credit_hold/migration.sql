-- Rezervace kreditu před voláním LLM (BIL-1). Nová tabulka, existující data se nemění.
-- CreateTable
CREATE TABLE "CreditHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CreditHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditHold_userId_status_idx" ON "CreditHold"("userId", "status");

-- CreateIndex
CREATE INDEX "CreditHold_status_expiresAt_idx" ON "CreditHold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CreditHold_jobId_idx" ON "CreditHold"("jobId");

-- AddForeignKey
ALTER TABLE "CreditHold" ADD CONSTRAINT "CreditHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

