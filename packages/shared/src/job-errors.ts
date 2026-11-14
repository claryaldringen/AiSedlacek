/**
 * Kódy chyb jobů workeru (`ProcessingJob.errorCode`). Worker ukládá kód vedle
 * české zprávy v `errors`; UI podle kódu zobrazí lokalizovanou hlášku – text
 * chyby z workeru (česky) ani surová zpráva SDK se uživateli neukazují.
 */
export const JOB_ERROR_CODES = [
  /** Uživatel překlad během běhu jobu ručně upravil – výsledek se neuložil. */
  'translation_changed',
  /** Výstup modelu byl useknutý (max_tokens) – neuložil se. */
  'output_truncated',
  /** Model požadavek odmítl (bezpečnostní filtr). */
  'model_refused',
  /** Model vrátil prázdný výstup. */
  'empty_output',
  /** Volný kredit nestačil na rezervaci volání. */
  'insufficient_credit',
  /**
   * Kredit je dočasně rezervovaný jiným běžícím zpracováním uživatele – bez té
   * rezervace by zůstatek stačil. Spustit znovu po jeho dokončení (nedobíjet).
   */
  'credit_busy',
  /** Chyba Claude API (přetížení, limit, výpadek sítě). */
  'api_error',
  /** Dokument nebo svazek už neexistuje (nebo nepatří uživateli). */
  'not_found',
  /** Jiná chyba. */
  'unknown',
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

export function isJobErrorCode(value: unknown): value is JobErrorCode {
  return typeof value === 'string' && (JOB_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Poznámka v `errors` jobu oprav kontextů u dokumentu, který opakovaný běh
 * (reclaim po pádu workeru) přeskočil: oprava proběhla a byla zaplacena už
 * v přerušeném běhu, ale nemusela se uložit. Worker ji zapisuje jako
 * `Dokument <id>: <poznámka>`; UI podle ní počítá přeskočené dokumenty
 * (`countFixContextSkipped`) – schéma pro ně nemá sloupec.
 */
export const FIX_CONTEXT_SKIPPED_NOTE =
  'přeskočen – oprava kontextu proběhla (a byla zaplacena) už v přerušeném běhu tohoto jobu; ' +
  'pokud tehdy selhala, kontext zůstal beze změny – opravte ho novým spuštěním';

/** Počet dokumentů, které oprava kontextů přeskočila (poznámky v `errors` jobu). */
export function countFixContextSkipped(errors: readonly unknown[]): number {
  return errors.filter((e) => typeof e === 'string' && e.endsWith(FIX_CONTEXT_SKIPPED_NOTE)).length;
}
