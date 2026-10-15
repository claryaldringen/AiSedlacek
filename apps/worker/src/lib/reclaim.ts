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
 * sloupec `attempts`, proto handlery při přepisu `errors` značky zachovávají
 * (`errorsKeepingReclaimMarkers`) – jinak by se počítadlo vynulovalo.
 */
export const RECLAIM_MARKER = 'Přerušeno restartem workeru';

function isReclaimMarker(error: string): boolean {
  return error.startsWith(RECLAIM_MARKER);
}

export function countReclaims(errors: string[]): number {
  return errors.filter(isReclaimMarker).length;
}

/**
 * Hodnota pro přepis `ProcessingJob.errors`: značky reclaimu, které už v DB jsou,
 * a za nimi chyby handleru. Prostý přepis (`data: { errors }`) by značky smazal –
 * job, který opakovaně shazuje worker, by pak obešel MAX_RECLAIMS a vracel se do
 * fronty donekonečna. Značky se čtou těsně před zápisem, aby se zachovala i ta,
 * kterou mezitím přidal periodický sweep.
 */
export async function errorsKeepingReclaimMarkers(
  jobId: string,
  errors: string[],
): Promise<string[]> {
  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { errors: true },
  });
  const markers = (job?.errors ?? []).filter(isReclaimMarker);
  return [...markers, ...errors];
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
