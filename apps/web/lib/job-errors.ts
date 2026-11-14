/**
 * Lokalizovaná hláška k chybě jobu podle kódu z workeru (`ProcessingJob.errorCode`).
 * Texty chyb v `errors` jsou česky (a obsahují interní detaily), UI proto pro
 * známé kódy ukáže vlastní hlášku v jazyce uživatele.
 */
import { isJobErrorCode } from '@ai-sedlacek/shared';

/** Klíč hlášky v namespace `workspace`, nebo null (pak platí obecná hláška volajícího). */
export function jobErrorMessageKey(errorCode: unknown): 'jobInsufficientCredit' | null {
  if (!isJobErrorCode(errorCode)) return null;
  return errorCode === 'insufficient_credit' ? 'jobInsufficientCredit' : null;
}
