-- Kód chyby jobu pro lokalizovanou hlášku v UI. Nový nullable sloupec, data beze změny.
-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "errorCode" TEXT;
