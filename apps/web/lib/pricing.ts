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

export type DisplayedCharge = {
  czk: number;
  credits: number;
  /** Odhad z tokenů podle aktuálního ceníku (bez záznamu skutečného odečtu). */
  estimated: boolean;
  /** Neúplná cena – odpověď chatu skončila bez známého odečtu (spojení spadlo). */
  incomplete?: boolean;
} | null;

/**
 * Cena chatu v této relaci: součet skutečně odečtených kreditů, které poslal
 * server (lib/chat-usage.ts). Bez nich (starší server) odhad z tokenů. Když
 * některá odpověď skončila bez známého odečtu, je cena označená jako neúplná.
 */
function chatCharge(result: {
  chatModel?: string | null;
  chatInputTokens?: number | null;
  chatOutputTokens?: number | null;
  chatChargedCredits?: number | null;
  chatChargeIncomplete?: boolean;
}): DisplayedCharge {
  const incomplete = result.chatChargeIncomplete ? { incomplete: true } : {};
  if (result.chatChargedCredits != null) {
    const credits = result.chatChargedCredits;
    return { czk: creditsToCzk(credits), credits, estimated: false, ...incomplete };
  }
  const estimate = chargeForUsage(
    result.chatModel,
    result.chatInputTokens,
    result.chatOutputTokens,
  );
  if (estimate) return { ...estimate, estimated: true, ...incomplete };
  return result.chatChargeIncomplete
    ? { czk: 0, credits: 0, estimated: false, incomplete: true }
    : null;
}

/**
 * Ceny dokumentu pro panel metadat. Cenu (útratu vlastníka) vidí jen vlastník –
 * u cizího dokumentu (`readOnly`) je všechno null. OCR a překlad: skutečný odečet,
 * u starších dokumentů odhad (označený). Chat: skutečně odečtené kredity odpovědí
 * v této relaci (i částečná spotřeba přerušené odpovědi), viz `chatCharge`.
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
    chatChargedCredits?: number | null;
    chatChargeIncomplete?: boolean;
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
  const chat = chatCharge(result);
  const parts = [ocr, translation, chat].filter(
    (c): c is NonNullable<DisplayedCharge> => c !== null,
  );
  const credits = parts.reduce((sum, c) => sum + c.credits, 0);
  const incomplete = parts.some((c) => c.incomplete);
  const total =
    credits > 0 || incomplete
      ? {
          czk: parts.reduce((sum, c) => sum + c.czk, 0),
          credits,
          estimated: parts.some((c) => c.estimated),
          ...(incomplete ? { incomplete: true } : {}),
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
