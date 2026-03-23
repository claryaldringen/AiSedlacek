/**
 * Processing Worker — polls Neon DB for queued ProcessingJobs and processes them.
 *
 * Supports job types: ocr, retranslate, generate-context, fix-contexts.
 *
 * Run: npm run worker (or npm run worker:dev for watch mode)
 * No Redis needed — reads jobs directly from PostgreSQL.
 */

import { prisma } from '../lib/infrastructure/db';
import { processPages } from './process-pages';
import { handleRetranslate } from './retranslate';
import { handleGenerateContext } from './generate-context';
import { handleFixContexts } from './fix-contexts';

const POLL_INTERVAL_MS = 3000;
let running = true;

async function pollForJobs(): Promise<void> {
  while (running) {
    try {
      // Find the oldest queued job and claim it atomically
      const job = await prisma.processingJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      });

      if (job) {
        // Claim the job — set status to 'running' (prevents other workers from picking it up)
        const claimed = await prisma.processingJob.updateMany({
          where: { id: job.id, status: 'queued' },
          data: { status: 'running', currentStep: 'Spouštím zpracování…' },
        });

        // If another worker claimed it first, skip
        if (claimed.count === 0) continue;

        const jobType = job.type || 'ocr';
        console.log(
          `[Worker] Processing job ${job.id} (type: ${jobType}, ${job.totalPages} pages)`,
        );

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
        }
      }
    } catch (err) {
      console.error('[Worker] Poll error:', err instanceof Error ? err.message : err);
    }

    // Wait before next poll
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

console.log(`[Worker] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);
void pollForJobs();
