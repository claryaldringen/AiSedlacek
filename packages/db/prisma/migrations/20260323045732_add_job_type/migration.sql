-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "jobData" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'ocr';
