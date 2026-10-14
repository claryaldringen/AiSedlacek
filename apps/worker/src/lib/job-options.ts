/**
 * Volby OCR jobu z `ProcessingJob.jobData`.
 */

export interface OcrJobOptions {
  /** Přegenerovat i stránky s existujícím dokumentem (DAT-1). */
  regenerate: boolean;
}

/**
 * Kontrakt s webem: OCR job (`type: 'ocr'`) může mít
 * `jobData = JSON.stringify({ regenerate: true })`. Chybějící nebo neplatný
 * `jobData` znamená běžné zpracování.
 */
export function parseOcrJobOptions(jobData: string | null | undefined): OcrJobOptions {
  if (!jobData) return { regenerate: false };
  try {
    const parsed = JSON.parse(jobData) as unknown;
    const regenerate =
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { regenerate?: unknown }).regenerate === true;
    return { regenerate };
  } catch {
    console.warn('[Worker] Ignoring invalid OCR jobData:', jobData.slice(0, 100));
    return { regenerate: false };
  }
}
