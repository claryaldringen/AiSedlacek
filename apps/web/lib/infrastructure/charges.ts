/**
 * Skutečné odečty kreditu (BIL-11) jsou údaj o útratě vlastníka – vidí je jen on.
 * Čtenářům cizího obsahu (členové sdíleného workspace) se nevracejí; UI pak
 * cenu nezobrazí.
 */

interface WithCharges {
  chargedCredits?: number | null;
  translations?: { chargedCredits?: number | null }[];
}

/** Kopie dokumentu bez skutečných odečtů (dokument i překlady), pokud čtenář není vlastník. */
export function hideChargesFromReader<T extends WithCharges>(doc: T, isOwner: boolean): T {
  if (isOwner) return doc;
  return {
    ...doc,
    chargedCredits: null,
    ...(doc.translations
      ? { translations: doc.translations.map((tr) => ({ ...tr, chargedCredits: null })) }
      : {}),
  };
}
