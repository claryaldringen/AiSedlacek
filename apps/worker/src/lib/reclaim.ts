/**
 * Obnova jobů osiřelých po pádu workeru (SIGKILL, OOM, deploy).
 */

import { prisma } from '@ai-sedlacek/db';
import { resetUnfinishedPages } from './page-status';

// A running job whose row hasn't been touched in this long is considered orphaned
// (the worker crashed mid-job). Active jobs update progress well within this window.
export const STALE_JOB_MS = 30 * 60 * 1000;

/**
 * Kolikrát smí být jeden job vrácen do fronty. Job, který opakovaně shodí worker
 * (typicky OOM u velkého svazku), by se jinak po každém restartu PM2 spustil znovu
 * a zablokoval zpracování všem ostatním (PERF-1). Po vyčerpání pokusů skončí `error`.
 */
export const MAX_RECLAIMS = 2;

/**
 * Značka v `ProcessingJob.errors`, podle které se počítají pokusy. Schéma nemá
 * sloupec `attempts`; pole `errors` worker při dokončení jobu přepisuje, takže
 * značky v něm zůstanou jen u jobů, které nedoběhly.
 */
export const RECLAIM_MARKER = 'Přerušeno restartem workeru';

export function countReclaims(errors: string[]): number {
  return errors.filter((e) => e.startsWith(RECLAIM_MARKER)).length;
}

/**
 * Re-queue jobs left in `running` by a crashed worker (SIGKILL/OOM/deploy),
 * and reset their pages from `processing` back to `pending`. Without this, such
 * jobs stay `running` forever and the user can never restart them.
 *
 * `onStartup` reclaims ALL running jobs (this deployment runs a single worker
 * instance, so on boot nothing is legitimately running); the periodic sweep only
 * touches jobs that have been stale for STALE_JOB_MS as a backstop.
 *
 * Job, který už byl vrácen MAX_RECLAIMS-krát, se znovu nespouští a skončí `error`.
 */
export async function reclaimStuckJobs(onStartup: boolean): Promise<void> {
  try {
    const where = onStartup
      ? { status: 'running' }
      : { status: 'running', updatedAt: { lt: new Date(Date.now() - STALE_JOB_MS) } };
    const stuck = await prisma.processingJob.findMany({
      where,
      select: { id: true, pageIds: true, errors: true },
    });
    if (stuck.length === 0) return;

    const requeue = stuck.filter((j) => countReclaims(j.errors) < MAX_RECLAIMS);
    const giveUp = stuck.filter((j) => countReclaims(j.errors) >= MAX_RECLAIMS);

    for (const job of requeue) {
      const attempt = countReclaims(job.errors) + 1;
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'queued',
          currentStep: 'Obnoveno po restartu — čeká ve frontě…',
          errors: { push: `${RECLAIM_MARKER} (obnova ${attempt}/${MAX_RECLAIMS})` },
        },
      });
    }

    for (const job of giveUp) {
      const message = `Zpracování bylo ${MAX_RECLAIMS + 1}× přerušeno pádem workeru (pravděpodobně nedostatek paměti) – job byl zastaven. Zkuste zpracovat menší počet stránek.`;
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'error',
          currentStep: `Chyba: ${message}`,
          errors: { push: message },
        },
      });
      console.error(`[Worker] Job ${job.id} gave up after ${MAX_RECLAIMS} reclaims`);
    }

    await resetUnfinishedPages(stuck.flatMap((j) => j.pageIds));
    console.log(
      `[Worker] Reclaimed ${requeue.length} stuck job(s), gave up ${giveUp.length} job(s)`,
    );
  } catch (err) {
    console.error('[Worker] reclaimStuckJobs failed:', err instanceof Error ? err.message : err);
  }
}
