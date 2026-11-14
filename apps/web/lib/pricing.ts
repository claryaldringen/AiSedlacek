/**
 * Zobrazení nákladů v UI – stejný výpočet jako účtování kreditů
 * (`@ai-sedlacek/shared` pricing), aby UI ukazovalo, co uživatel skutečně platí.
 */
import {
  MODEL_PRICING_USD,
  creditsForUsage,
  creditsToCzk,
  usagePriceCzk,
} from '@ai-sedlacek/shared';

export const MODEL_PRICING = MODEL_PRICING_USD;

/** Cena volání pro uživatele v Kč a v kreditech, nebo null bez spotřeby. */
export function chargeForUsage(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): { czk: number; credits: number } | null {
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  if (input <= 0 && output <= 0) return null;
  return {
    czk: usagePriceCzk(model, input, output),
    credits: creditsForUsage(model, input, output),
  };
}

/**
 * Cena výsledku pro zobrazení (BIL-11): skutečně odečtené kredity, pokud jsou
 * uložené, jinak odhad z tokenů podle aktuálního ceníku (`estimated: true` –
 * dokumenty zpracované před zavedením záznamu odečtu).
 */
export function documentCharge(
  chargedCredits: number | null | undefined,
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): { czk: number; credits: number; estimated: boolean } | null {
  if (chargedCredits != null) {
    return { czk: creditsToCzk(chargedCredits), credits: chargedCredits, estimated: false };
  }
  const estimate = chargeForUsage(model, inputTokens, outputTokens);
  return estimate ? { ...estimate, estimated: true } : null;
}

export type DisplayedCharge = { czk: number; credits: number; estimated: boolean } | null;

/**
 * Ceny dokumentu pro panel metadat. Cenu (útratu vlastníka) vidí jen vlastník –
 * u cizího dokumentu (`readOnly`) je všechno null. OCR a překlad: skutečný odečet,
 * u starších dokumentů odhad (označený). Chat se účtuje přesně podle usage odpovědí
 * v této relaci, takže jeho cena není odhad.
 */
export function resultCharges(
  result: {
    chargedCredits?: number | null;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    translationChargedCredits?: number | null;
    translationModel?: string | null;
    translationInputTokens?: number | null;
    translationOutputTokens?: number | null;
    chatModel?: string | null;
    chatInputTokens?: number | null;
    chatOutputTokens?: number | null;
  },
  readOnly: boolean,
): {
  ocr: DisplayedCharge;
  translation: DisplayedCharge;
  chat: DisplayedCharge;
  total: DisplayedCharge;
} {
  if (readOnly) return { ocr: null, translation: null, chat: null, total: null };
  const ocr = documentCharge(
    result.chargedCredits,
    result.model,
    result.inputTokens,
    result.outputTokens,
  );
  const translation = documentCharge(
    result.translationChargedCredits,
    result.translationModel,
    result.translationInputTokens,
    result.translationOutputTokens,
  );
  const chatUsage = chargeForUsage(
    result.chatModel,
    result.chatInputTokens,
    result.chatOutputTokens,
  );
  const chat = chatUsage ? { ...chatUsage, estimated: false } : null;
  const parts = [ocr, translation, chat].filter(
    (c): c is NonNullable<DisplayedCharge> => c !== null,
  );
  const credits = parts.reduce((sum, c) => sum + c.credits, 0);
  const total =
    credits > 0
      ? {
          czk: parts.reduce((sum, c) => sum + c.czk, 0),
          credits,
          estimated: parts.some((c) => c.estimated),
        }
      : null;
  return { ocr, translation, chat, total };
}

/** Částka v Kč na 2 desetinná místa (u velmi malých částek víc, ať není „0,00"). */
export function formatCzk(czk: number, locale: string): string {
  return czk.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: czk < 0.01 ? 4 : 2,
  });
}
