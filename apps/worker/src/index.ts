/**
 * Processing Worker — polls Neon DB for queued ProcessingJobs and processes them.
 *
 * Concurrency model:
 * - Jobs run in parallel by default
 * - OCR jobs for the SAME collection run sequentially (to preserve page context)
 * - Everything else (retranslate, generate-context, fix-contexts, OCR of different
 *   collections) runs concurrently
 *
 * Run: npm start (or npm run dev for watch mode)
 */

import { prisma } from '@ai-sedlacek/db';
import { processPages } from './handlers/process-pages';
import { handleRetranslate } from './handlers/retranslate';
import { handleGenerateContext } from './handlers/generate-context';
import { handleFixContexts } from './handlers/fix-contexts';
import { handleTranslateContext } from './handlers/translate-context';

const POLL_INTERVAL_MS = 3000;
const MAX_CONCURRENT_JOBS = 5;
let running = true;
let activeJobCount = 0;

// Track which collections have an active OCR job (to keep OCR sequential per collection)
const activeOcrCollections = new Set<string>();

async function executeJob(job: {
  id: string;
  userId: string;
  type: string;
  totalPages: number;
  pageIds: string[];
  collectionId: string | null;
  language: string;
  mode: string;
  jobData: string | null;
}): Promise<void> {
  const jobType = job.type || 'ocr';
  const collectionKey = job.collectionId ?? job.id;
  console.log(`[Worker] Processing job ${job.id} (type: ${jobType}, collection: ${collectionKey})`);

  try {
    switch (jobType) {
      case 'ocr':
        await processPages({
          jobId: job.id,
          userId: job.userId,
          pageIds: job.pageIds,
          collectionId: job.collectionId ?? undefined,
          language: job.language,
          mode: job.mode as 'transcribe+translate' | 'translate',
        });
        break;

      case 'retranslate':
        await handleRetranslate(job.id, JSON.parse(job.jobData!));
        break;

      case 'generate-context':
        await handleGenerateContext(job.id, JSON.parse(job.jobData!));
        break;

      case 'fix-contexts':
        await handleFixContexts(job.id, JSON.parse(job.jobData!));
        break;

      case 'translate-context':
        await handleTranslateContext(job.id, JSON.parse(job.jobData!));
        break;

      default:
        throw new Error(`Neznámý typ jobu: ${jobType}`);
    }
    console.log(`[Worker] Job ${job.id} (${jobType}) completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Neznámá chyba';
    console.error(`[Worker] Job ${job.id} (${jobType}) failed:`, message);
    await prisma.processingJob
      .update({
        where: { id: job.id },
        data: {
          status: 'error',
          currentStep: `Chyba: ${message}`,
          errors: { push: message },
        },
      })
      .catch(() => {});

    // Reset stuck "processing" pages back to "pending" so they can be retried
    if (jobType === 'ocr' && job.pageIds.length > 0) {
      const resetResult = await prisma.page
        .updateMany({
          where: { id: { in: job.pageIds }, status: 'processing' },
          data: { status: 'pending', errorMessage: null },
        })
        .catch(() => ({ count: 0 }));
      if (resetResult.count > 0) {
        console.log(`[Worker] Reset ${resetResult.count} stuck pages to pending for job ${job.id}`);
      }
    }
  } finally {
    activeJobCount--;
    if (jobType === 'ocr') {
      activeOcrCollections.delete(collectionKey);
    }
  }
}

async function pollForJobs(): Promise<void> {
  while (running) {
    try {
      if (activeJobCount >= MAX_CONCURRENT_JOBS) {
        // At capacity — wait before polling
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      const jobs = await prisma.processingJob.findMany({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      for (const job of jobs) {
        if (activeJobCount >= MAX_CONCURRENT_JOBS) break;

        const jobType = job.type || 'ocr';
        const collectionKey = job.collectionId ?? job.id;

        // OCR jobs for the same collection must be sequential
        if (jobType === 'ocr' && activeOcrCollections.has(collectionKey)) {
          continue; // Skip — another OCR for this collection is running
        }

        // Claim the job atomically
        const claimed = await prisma.processingJob.updateMany({
          where: { id: job.id, status: 'queued' },
          data: { status: 'running', currentStep: 'Spouštím zpracování…' },
        });

        if (claimed.count === 0) continue;

        // Track and launch concurrently
        activeJobCount++;
        if (jobType === 'ocr') {
          activeOcrCollections.add(collectionKey);
        }
        void executeJob(job);
      }
    } catch (err) {
      console.error('[Worker] Poll error:', err instanceof Error ? err.message : err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Worker] Shutting down…');
  running = false;
});
process.on('SIGINT', () => {
  console.log('[Worker] Shutting down…');
  running = false;
});

console.log(
  `[Worker] Started — polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT_JOBS} concurrent jobs`,
);
void pollForJobs();
