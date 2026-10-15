/**
 * Ceník: náklady API podle modelu a přepočet na kredity, které platí uživatel.
 *
 * Jediný zdroj pravdy pro účtování (packages/db/billing) i zobrazení v UI.
 * Uživatel platí skutečný náklad API × marže; kredit („token" v UI) má pevnou
 * cenu při dobití, takže zůstatky koupené dřív si drží hodnotu.
 */

/** Ceny modelů v USD za 1M tokenů (vstup / výstup) – ceník Anthropic k 2026-10-06. */
export const MODEL_PRICING_USD: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Neznámý model (nový fallback, překlep v konfiguraci) se účtuje nejdražší
 * sazbou – nikdy pod náklady.
 */
const UNKNOWN_MODEL_RATES = { input: 15, output: 75 };

export const BILLING = {
  /** Cena 1M kreditů při dobití (Kč). Neměnit – zůstatky jsou v kreditech. */
  creditPriceCzkPerMillion: 50,
  /** Kurz pro přepočet nákladů API (USD) na Kč. */
  usdToCzk: 23,
  /** Prodejní cena = náklad API × marže. */
  markup: 2,
} as const;

/** Sazby modelu; ID s datem (`claude-…-20260101`) se dohledá i bez data. */
export function modelRates(model: string | null | undefined): { input: number; output: number } {
  if (!model) return UNKNOWN_MODEL_RATES;
  return (
    MODEL_PRICING_USD[model] ??
    MODEL_PRICING_USD[model.replace(/-\d{8}$/, '')] ??
    UNKNOWN_MODEL_RATES
  );
}

/** Skutečný náklad volání API v USD. */
export function usageCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = modelRates(model);
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/** Cena volání pro uživatele v Kč (náklad × kurz × marže). */
export function usagePriceCzk(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  return usageCostUsd(model, inputTokens, outputTokens) * BILLING.usdToCzk * BILLING.markup;
}

/** Počet kreditů, které se za volání odečtou (zaokrouhleno nahoru). */
export function creditsForUsage(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (inputTokens <= 0 && outputTokens <= 0) return 0;
  const rates = modelRates(model);
  // (tokeny × USD/1M) / 1M × kurz × marže / (Kč za 1M kreditů) × 1M – milióny se
  // vykrátí; počítat bez dělení, ať float šum (12880.000000002) nezaokrouhlí nahoru.
  const credits =
    ((inputTokens * rates.input + outputTokens * rates.output) *
      BILLING.usdToCzk *
      BILLING.markup) /
    BILLING.creditPriceCzkPerMillion;
  return Math.ceil(credits - 1e-9);
}

/** Kredity za dobití částky v haléřích. */
export function czkToCredits(amountHalire: number): number {
  return Math.floor((amountHalire / 100 / BILLING.creditPriceCzkPerMillion) * 1_000_000);
}

/** Hodnota kreditů v Kč. */
export function creditsToCzk(credits: number): number {
  return (credits / 1_000_000) * BILLING.creditPriceCzkPerMillion;
}
