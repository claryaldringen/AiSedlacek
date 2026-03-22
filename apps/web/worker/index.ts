/**
 * BullMQ worker entry point.
 *
 * Run with: `tsx worker/index.ts` from apps/web/
 * Or via npm script: `npm run worker` / `npm run worker:dev`
 *
 * Consumes OCR processing jobs from Redis and processes them
 * using the same pipeline as the former Inngest function.
 */

import { Worker } from 'bullmq';
import { QUEUE_NAME } from '@/lib/infrastructure/queue';
import { processPages } from './process-pages';

function parseRedisUrl(): { host: string; port: number; password?: string; db?: number } {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.pathname && parsed.pathname.length > 1
      ? { db: parseInt(parsed.pathname.slice(1), 10) }
      : {}),
  };
}

const worker = new Worker(QUEUE_NAME, processPages, {
  connection: {
    ...parseRedisUrl(),
    maxRetriesPerRequest: null,
  },
  concurrency: 1,
});

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('ready', () => {
  console.log(`[Worker] Listening on queue "${QUEUE_NAME}"`);
});

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  console.log('[Worker] Shutting down…');
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[Worker] Starting…');
