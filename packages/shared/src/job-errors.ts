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
