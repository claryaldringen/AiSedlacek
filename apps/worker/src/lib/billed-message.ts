/**
 * Textové volání LLM s rezervací kreditu (BIL-1).
 */

import { runBilledCall, type BillingOutcome } from '@ai-sedlacek/db/billing';
import { estimateInputTokens, reservationCredits } from '@ai-sedlacek/shared';
import { createMessage, type LlmResponse } from './llm';

export interface CallBilling {
  userId: string;
  jobId: string;
  /** Deterministický klíč operace – opakovaný běh jobu neúčtuje dvakrát. */
  referenceId: string;
  description: string;
}

/** Kredity rezervované před textovým voláním: odhad vstupu + celý `maxTokens`. */
export function textCallReservation(params: Parameters<typeof createMessage>[0]): number {
  const promptText = [params.system ?? '', ...params.messages.map((m) => m.content)].join('\n');
  return reservationCredits([params.model], estimateInputTokens(promptText), params.maxTokens);
}

/**
 * Zarezervuje maximální cenu volání, zavolá model a vyúčtuje skutečnou spotřebu
 * (sazbou modelu z odpovědi); nevyužitá část rezervace se vrátí. Vyúčtování
 * proběhne hned po volání – i když volající výsledek nakonec neuloží (useknutý
 * výstup apod.), spotřeba vznikla.
 *
 * @throws InsufficientCreditError, když volný kredit na rezervaci nestačí –
 *   volání se pak vůbec nespustí
 */
export async function createBilledMessage(
  billing: CallBilling,
  params: Parameters<typeof createMessage>[0],
): Promise<{ response: LlmResponse; billing: BillingOutcome }> {
  const { result, billing: outcome } = await runBilledCall(
    { ...billing, amount: textCallReservation(params) },
    () => createMessage(params),
    (response) => [
      {
        referenceId: billing.referenceId,
        description: billing.description,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      },
    ],
  );
  return { response: result, billing: outcome };
}
