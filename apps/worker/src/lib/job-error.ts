/**
 * Chyby jobů s kódem pro lokalizaci v UI (`ProcessingJob.errorCode`).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { JobErrorCode } from '@ai-sedlacek/shared';

/** Chyba jobu se známým kódem; `message` (česky) jde do logu a `errors` jobu. */
export class JobError extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

/**
 * Kód a text chyby pro zápis do jobu. Surová zpráva SDK (chyby API) jde jen do
 * logu – v `errors` je obecný text se stavovým kódem, v UI lokalizovaná hláška.
 */
export function describeJobError(err: unknown): { code: JobErrorCode; message: string } {
  if (err instanceof JobError) return { code: err.code, message: err.message };
  // InsufficientCreditError z @ai-sedlacek/db/billing (podle kódu – bez závislosti
  // na konkrétní instanci třídy, kterou testy mockují)
  if (err instanceof Error && (err as Error & { code?: unknown }).code === 'insufficient_credit') {
    return { code: 'insufficient_credit', message: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ? ` ${err.status}` : '';
    return { code: 'api_error', message: `Chyba služby Claude API${status} – zkuste to znovu` };
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : 'Neznámá chyba' };
}
