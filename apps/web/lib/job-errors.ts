/**
 * Lokalizovaná hláška k chybě jobu podle kódu z workeru (`ProcessingJob.errorCode`).
 * Texty chyb v `errors` jsou česky (a obsahují interní detaily), UI proto pro
 * známé kódy ukáže vlastní hlášku v jazyce uživatele.
 */
import { isJobErrorCode } from '@ai-sedlacek/shared';

export type JobMessageKey =
  | 'jobInsufficientCredit'
  | 'jobCreditBusy'
  | 'jobPartialInsufficientCredit';

/**
 * Klíč hlášky (namespace `workspace`) k jobu, který skončil chybou, nebo null
 * (pak platí obecná hláška volajícího): nedostatek kreditu → výzva k dobití,
 * kredit blokovaný jiným běžícím zpracováním → spustit znovu po jeho dokončení.
 */
export function jobErrorMessageKey(
  errorCode: unknown,
): 'jobInsufficientCredit' | 'jobCreditBusy' | null {
  if (!isJobErrorCode(errorCode)) return null;
  if (errorCode === 'insufficient_credit') return 'jobInsufficientCredit';
  if (errorCode === 'credit_busy') return 'jobCreditBusy';
  return null;
}

/**
 * Klíč hlášky podle výsledku jobu: u `error` jako `jobErrorMessageKey`, u
 * `completed` s kódem nedostatku kreditu upozornění, že se část stránek
 * nezpracovala (job doběhl, ale některé stránky přeskočil). Jinak null.
 */
export function jobOutcomeMessageKey(outcome: string, errorCode: unknown): JobMessageKey | null {
  if (outcome === 'error') return jobErrorMessageKey(errorCode);
  if (outcome === 'completed' && errorCode === 'insufficient_credit') {
    return 'jobPartialInsufficientCredit';
  }
  return null;
}
