/**
 * Předběžná kontrola kreditu před založením OCR jobu (POST /api/pages/process).
 *
 * Minimum se odvozuje z toho, co job se stránkami opravdu udělá – zrcadlí
 * přípravu stránek ve workeru (apps/worker/src/handlers/process-pages.ts):
 *
 * - prázdná stránka, nebo stránka s dokumentem i překladem do cílového jazyka → nic,
 * - stránka s dokumentem bez překladu do cílového jazyka → překlad (Sonnet),
 * - stránka bez dokumentu, ke které existuje zdroj deduplikace → cena kopie,
 * - jinak (nebo při regeneraci) → OCR stránky (rezervace maximální ceny).
 *
 * Kontrola chce jen kredit na nejlevnější placený krok – job pak udělá, co
 * kredit pokryje. Závazná rezervace proběhne ve workeru před každým voláním.
 */
import { ocrBatchReservationCredits, type ProcessingMode } from '@ai-sedlacek/ocr';
import {
  LLM_MAX_TOKENS,
  NON_DEDUP_MODELS,
  TEXT_MODEL,
  creditsForUsage,
  reservationCredits,
} from '@ai-sedlacek/shared';
import { prisma } from './db';

export interface JobPage {
  id: string;
  status: string;
  hash: string;
  document: { translations: { language: string }[] } | null;
}

/**
 * @returns nejmenší kredit, který musí být volný, nebo null, když job nic
 *   placeného neudělá (předběžná kontrola se pak přeskočí)
 */
export async function minimumJobCredit(
  userId: string,
  pages: JobPage[],
  options: { language: string; mode: ProcessingMode; regenerate: boolean },
): Promise<number | null> {
  const costs: number[] = [];
  const withoutDocument: JobPage[] = [];

  for (const page of pages) {
    if (page.status === 'blank') continue;
    if (page.document && !options.regenerate) {
      const translations = page.document.translations;
      if (translations.some((t) => t.language === options.language)) continue;
      // Dokument bez jakéhokoli překladu (starší záznam) jde ve workeru přes OCR
      costs.push(
        translations.length > 0
          ? reservationCredits([TEXT_MODEL], 0, LLM_MAX_TOKENS.translateDocument)
          : ocrBatchReservationCredits(1, '', options.mode),
      );
      continue;
    }
    if (page.document || options.regenerate) {
      costs.push(ocrBatchReservationCredits(1, '', options.mode));
      continue;
    }
    withoutDocument.push(page);
  }

  if (withoutDocument.length > 0) {
    // Zdroj deduplikace – stejná kritéria jako findDedupSourceDocument ve workeru:
    // jen vlastní nearchivované dokumenty z placeného API volání.
    const sources = await prisma.document.findMany({
      where: {
        hash: { in: [...new Set(withoutDocument.map((p) => p.hash))] },
        page: { userId, status: { not: 'archived' } },
        model: { notIn: [...NON_DEDUP_MODELS] },
        outputTokens: { gt: 0 },
      },
      select: { hash: true, model: true, inputTokens: true, outputTokens: true },
    });
    const copyCost = new Map<string, number>();
    for (const s of sources) {
      const cost = creditsForUsage(s.model, s.inputTokens ?? 0, s.outputTokens ?? 0);
      copyCost.set(s.hash, Math.min(copyCost.get(s.hash) ?? Infinity, cost));
    }
    for (const page of withoutDocument) {
      costs.push(copyCost.get(page.hash) ?? ocrBatchReservationCredits(1, '', options.mode));
    }
  }

  return costs.length > 0 ? Math.min(...costs) : null;
}
