-- CreateEnum
CREATE TYPE "TokenTransactionType" AS ENUM ('topup_stripe', 'topup_bank', 'consumption', 'refund');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "variableSymbol" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "User_variableSymbol_key" ON "User"("variableSymbol");

-- CreateTable
CREATE TABLE "TokenTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TokenTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "amountCzk" INTEGER,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransaction_userId_referenceId_key" ON "TokenTransaction"("userId", "referenceId");

-- CreateIndex
CREATE INDEX "TokenTransaction_userId_createdAt_idx" ON "TokenTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TokenTransaction" ADD CONSTRAINT "TokenTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
