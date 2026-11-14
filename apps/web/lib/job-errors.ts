/**
 * Lokalizovaná hláška k chybě jobu podle kódu z workeru (`ProcessingJob.errorCode`).
 * Texty chyb v `errors` jsou česky (a obsahují interní detaily), UI proto pro
 * známé kódy ukáže vlastní hlášku v jazyce uživatele.
 */
import { isJobErrorCode } from '@ai-sedlacek/shared';

/**
 * Druh jobu pro text hlášky: `ocr` zpracovává stránky (nedokončené se vrací
 * k novému spuštění), `text` jsou joby bez stránek (kontexty, retranslace).
 */
export type JobKind = 'ocr' | 'text';

export type JobMessageKey =
  | 'jobInsufficientCredit'
  | 'jobCreditBusy'
  | 'jobCreditBusyText'
  | 'jobPartialInsufficientCredit';

/**
 * Klíč hlášky (namespace `workspace`) k jobu, který skončil chybou, nebo null
 * (pak platí obecná hláška volajícího): nedostatek kreditu → výzva k dobití,
 * kredit blokovaný jiným běžícím zpracováním → spustit znovu po jeho dokončení
 * (u OCR s poznámkou o nedokončených stránkách, u textových jobů obecně).
 */
export function jobErrorMessageKey(
  errorCode: unknown,
  kind: JobKind,
): 'jobInsufficientCredit' | 'jobCreditBusy' | 'jobCreditBusyText' | null {
  if (!isJobErrorCode(errorCode)) return null;
  if (errorCode === 'insufficient_credit') return 'jobInsufficientCredit';
  if (errorCode === 'credit_busy') return kind === 'ocr' ? 'jobCreditBusy' : 'jobCreditBusyText';
  return null;
}

/**
 * Klíč hlášky podle výsledku jobu: u `error` jako `jobErrorMessageKey`, u
 * `completed` s kódem nedostatku kreditu upozornění, že se část stránek
 * nezpracovala (job doběhl, ale některé stránky přeskočil). Jinak null.
 */
export function jobOutcomeMessageKey(
  outcome: string,
  errorCode: unknown,
  kind: JobKind,
): JobMessageKey | null {
  if (outcome === 'error') return jobErrorMessageKey(errorCode, kind);
  if (outcome === 'completed' && errorCode === 'insufficient_credit') {
    return 'jobPartialInsufficientCredit';
  }
  return null;
}

/**
 * Hláška k opravě kontextů zastavené kvůli kreditu: kolik dokumentů je
 * opravených (`completedPages` jobu při zastavení) a že nové spuštění opraví
 * všechny dokumenty svazku znovu – job nepokračuje tam, kde skončil.
 */
export function fixContextsCreditMessage(
  outcome: string,
  errorCode: unknown,
  progress: { completed: number; total: number } | null,
): {
  key: 'fixContextsInsufficientCredit' | 'fixContextsCreditBusy';
  values: { fixed: number; total: number };
} | null {
  if (outcome !== 'error') return null;
  if (errorCode !== 'insufficient_credit' && errorCode !== 'credit_busy') return null;
  return {
    key: errorCode === 'credit_busy' ? 'fixContextsCreditBusy' : 'fixContextsInsufficientCredit',
    values: { fixed: progress?.completed ?? 0, total: progress?.total ?? 0 },
  };
}
