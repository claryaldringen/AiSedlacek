/**
 * Čekání jobu na kredit blokovaný jinými běžícími akcemi téhož uživatele.
 *
 * Volný kredit = zůstatek − aktivní rezervace. Když uživatel spustí dva joby
 * naráz, druhý může narazit na rezervaci prvního, i když by mu zůstatek sám
 * stačil. Takový job nesmí skončit chybou „Nedostatečný kredit“ – vrátí se do
 * fronty s odkladem (`notBefore`) a zkusí to znovu, až se rezervace uvolní
 * (po vyúčtování se nevyužitá část vrací). Slot workeru se mezitím neblokuje;
 * počet odkladů je omezený.
 */

import { prisma } from '@ai-sedlacek/db';
import { isBlockedByOtherHolds } from '@ai-sedlacek/db/billing';

/** Nejvýš tolik odkladů (s backoffem až ~45 minut čekání), pak chyba. */
export const MAX_CREDIT_WAITS = 12;

/** Odklad n-tého čekání: 15 s, 30 s, 1 min … nejvýš 5 min. */
export function creditWaitDelayMs(waits: number): number {
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, waits));
}

/** Kredit chybí jen kvůli rezervacím jiných běžících akcí – job má počkat. */
export class CreditBusyError extends Error {
  readonly code = 'credit_busy';
  constructor(readonly shortage: { required: number; balance: number; reserved: number }) {
    super(
      `Kredit je dočasně rezervovaný jinou běžící akcí (potřeba ${shortage.required}, ` +
        `zůstatek ${shortage.balance}, rezervováno ${shortage.reserved})`,
    );
    this.name = 'CreditBusyError';
  }
}

/**
 * Má job počkat na uvolnění kreditu? `CreditBusyError` z handleru, nebo
 * `InsufficientCreditError` z rezervace, u které by bez cizích rezervací
 * zůstatek stačil.
 */
export function isCreditBusy(err: unknown): boolean {
  if (err instanceof CreditBusyError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; required?: unknown; balance?: unknown; reserved?: unknown };
  return (
    e.code === 'insufficient_credit' &&
    typeof e.required === 'number' &&
    isBlockedByOtherHolds({
      required: e.required,
      balance: typeof e.balance === 'number' ? e.balance : 0,
      reserved: typeof e.reserved === 'number' ? e.reserved : 0,
    })
  );
}

/**
 * Vrátí job do fronty s odkladem. Stránky OCR zůstávají ve stavu `processing`
 * (job pokračuje, jen později); hotové stránky opakovaný běh přeskočí.
 *
 * @returns false, když je limit odkladů vyčerpaný – volající job ukončí chybou
 */
export async function requeueForCredit(jobId: string): Promise<boolean> {
  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { creditWaits: true, status: true },
  });
  if (!job || job.creditWaits >= MAX_CREDIT_WAITS) return false;
  const delay = creditWaitDelayMs(job.creditWaits);
  // Jen běžící job – zrušení uživatelem během čekání má přednost.
  const { count } = await prisma.processingJob.updateMany({
    where: { id: jobId, status: 'running' },
    data: {
      status: 'queued',
      notBefore: new Date(Date.now() + delay),
      creditWaits: { increment: 1 },
      currentStep: 'Čeká na uvolnění kreditu rezervovaného jiným zpracováním…',
    },
  });
  if (count > 0) {
    console.log(
      `[Worker] Job ${jobId} waits for credit held by other actions (${job.creditWaits + 1}/${MAX_CREDIT_WAITS}, ${Math.round(delay / 1000)} s)`,
    );
  }
  return true;
}

/** Hláška jobu, když kredit zůstal blokovaný i po všech odkladech. */
export const CREDIT_WAIT_EXHAUSTED_MESSAGE =
  'Kredit zůstal dlouho rezervovaný jinými běžícími zpracováními – job se nespustil, zkuste to znovu později';
