/**
 * Zpracování chyby jobu ve workeru (z `executeJob`).
 */

import { prisma } from '@ai-sedlacek/db';
import { describeJobError } from './job-error';
import { resetUnfinishedPages } from './page-status';

/**
 * Job vyhodil chybu: ukončí ho chybou s kódem pro UI (`errorCode`) a nedokončené
 * stránky OCR vrátí do výchozího stavu. Kredit blokovaný jinými běžícími akcemi
 * uživatele je `credit_busy` (spustit znovu po jejich dokončení), skutečný
 * nedostatek `insufficient_credit` – job se v žádném případě neodkládá.
 */
export async function handleJobFailure(
  job: { id: string; type: string; pageIds: string[] },
  err: unknown,
): Promise<void> {
  // Surová chyba jen do logu; do jobu kód (UI podle něj ukáže lokalizovanou
  // hlášku) a text bez interních detailů SDK.
  const { code, message } = describeJobError(err);
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
}
