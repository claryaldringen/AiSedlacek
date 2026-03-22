/**
 * OCR Worker — polls Neon DB for queued ProcessingJobs and processes them.
 *
 * Run: npm run worker (or npm run worker:dev for watch mode)
 * No Redis needed — reads jobs directly from PostgreSQL.
 */

import { prisma } from '../lib/infrastructure/db';
import { processPages } from './process-pages';

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

        console.log(`[Worker] Processing job ${job.id} (${job.totalPages} pages)`);

        try {
          await processPages({
            jobId: job.id,
            userId: job.userId,
            pageIds: job.pageIds,
            collectionId: job.collectionId ?? undefined,
            language: job.language,
            mode: job.mode as 'transcribe+translate' | 'translate',
          });
          console.log(`[Worker] Job ${job.id} completed`);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Neznámá chyba';
          console.error(`[Worker] Job ${job.id} failed:`, message);
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
