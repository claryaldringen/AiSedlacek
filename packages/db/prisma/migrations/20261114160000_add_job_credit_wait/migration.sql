-- Odklad jobu, když kredit blokují jiné běžící akce uživatele. Nové sloupce
-- (nullable a NOT NULL s výchozí hodnotou 0), existující data se nemění.
-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "creditWaits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notBefore" TIMESTAMP(3);
