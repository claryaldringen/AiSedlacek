/**
 * Zpracování chyby jobu ve workeru (z `executeJob`).
 */

import { prisma } from '@ai-sedlacek/db';
import { CREDIT_WAIT_EXHAUSTED_MESSAGE, isCreditBusy, requeueForCredit } from './credit-wait';
import { JobError, describeJobError } from './job-error';
import { resetUnfinishedPages } from './page-status';

/**
 * Job vyhodil chybu: buď ho vrátí do fronty (kredit blokují jiné běžící akce
 * uživatele – čekání s odkladem), nebo ho ukončí chybou s kódem pro UI.
 */
export async function handleJobFailure(
  job: { id: string; type: string; pageIds: string[] },
  err: unknown,
): Promise<'requeued' | 'failed'> {
  let failure = err;
  if (isCreditBusy(err)) {
    if (await requeueForCredit(job.id).catch(() => false)) return 'requeued';
    failure = new JobError('insufficient_credit', CREDIT_WAIT_EXHAUSTED_MESSAGE);
  }

  // Surová chyba jen do logu; do jobu kód (UI podle něj ukáže lokalizovanou
  // hlášku) a text bez interních detailů SDK.
  const { code, message } = describeJobError(failure);
  console.error(
    `[Worker] Job ${job.id} (${job.type}) failed [${code}]:`,
    err instanceof Error ? err.message : err,
  );
  await prisma.processingJob
    .update({
      where: { id: job.id },
      data: {
        status: 'error',
        currentStep: `Chyba: ${message}`,
        errors: { push: message },
        errorCode: code,
      },
    })
    .catch(() => {});

  // Reset stuck "processing" pages back to "pending" so they can be retried
  if (job.type === 'ocr' && job.pageIds.length > 0) {
    const resetCount = await resetUnfinishedPages(job.pageIds).catch(() => 0);
    if (resetCount > 0) {
      console.log(`[Worker] Reset ${resetCount} stuck pages for job ${job.id}`);
    }
  }
  return 'failed';
}
