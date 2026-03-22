/**
 * BullMQ queue for OCR page processing.
 *
 * API routes use `getProcessingQueue()` to enqueue jobs.
 * The worker process (apps/web/worker/index.ts) consumes from this queue.
 */

import { Queue } from 'bullmq';

export const QUEUE_NAME = 'ocr-processing';

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

let queue: Queue | null = null;

export function getProcessingQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: {
        ...parseRedisUrl(),
        maxRetriesPerRequest: null,
      },
    });
  }
  return queue;
}
