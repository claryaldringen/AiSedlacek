/**
 * Skutečné odečty kreditu (BIL-11) jsou údaj o útratě vlastníka – vidí je jen on.
 * Totéž platí pro model a počty tokenů, ze kterých se cena dá dopočítat
 * (ceník je veřejný). Čtenářům cizího obsahu (členové sdíleného workspace) se
 * nevracejí; UI pak cenu, model ani tokeny nezobrazí.
 */

interface UsageFields {
  chargedCredits?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface WithCharges extends UsageFields {
  translations?: UsageFields[];
}

const HIDDEN_USAGE = {
  chargedCredits: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
} as const;

/**
 * Kopie dokumentu bez údajů o útratě (skutečné odečty, model, tokeny – dokument
 * i překlady), pokud čtenář není vlastník.
 */
export function hideChargesFromReader<T extends WithCharges>(doc: T, isOwner: boolean): T {
  if (isOwner) return doc;
  return {
    ...doc,
    ...HIDDEN_USAGE,
    ...(doc.translations
      ? { translations: doc.translations.map((tr) => ({ ...tr, ...HIDDEN_USAGE })) }
      : {}),
  };
}
