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

/**
 * Kategorie odmítnutí (`stop_details.category` / `trigger.category` fallback
 * bloku), u kterých Anthropic účtuje i odmítnutí PŘED jakýmkoli výstupem –
 * běžně, sazbou modelu, který odmítl. Odmítnutí před výstupem v jiné kategorii
 * nebo s `null` kategorií se neúčtuje; odmítnutí uprostřed výstupu se účtuje
 * vždy. Stav k 2026-09 podle dokumentace („How refusals are billed",
 * platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) – může
 * se měnit, při změně upravit tady.
 */
export const BILLED_PRE_OUTPUT_REFUSAL_CATEGORIES: readonly string[] = [
  'bio',
  'frontier_llm',
  'reasoning_extraction',
];

/**
 * Účtuje Anthropic odmítnutý pokus? Ano, pokud odmítl uprostřed výstupu
 * (`outputTokens > 0`), nebo před výstupem v účtované kategorii.
 */
export function isRefusalBilled(outputTokens: number, category: string | null): boolean {
  return (
    outputTokens > 0 ||
    (category !== null && BILLED_PRE_OUTPUT_REFUSAL_CATEGORIES.includes(category))
  );
}

/**
 * Horní odhad počtu vstupních tokenů textu pro rezervaci kreditu (BIL-1).
 * Tokenizér Claude dává na token alespoň jeden bajt UTF-8; dva bajty na token
 * jsou s rezervou i pro češtinu, starou němčinu a latinu (skutečně ~3–4 znaky
 * na token). Přesný počet zná až odpověď API – rezervace jen nesmí výrazně
 * podstřelit, nevyužitá část se po volání vrací.
 */
export function estimateInputTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(new TextEncoder().encode(text).length / 2);
}

/**
 * Strop tokenů jednoho obrázku u modelů s vysokým rozlišením (Opus 4.7+,
 * Sonnet 5+): delší strana se zmenší na 2576 px, nejvýš ~4784 tokenů. Starší
 * modely (Sonnet 4.6) mají strop nižší, takže odhad je pro ně s rezervou.
 */
export const MAX_IMAGE_INPUT_TOKENS = 4_784;

/**
 * Režie zprávy (role, oddělovače bloků, systémové tokeny API) navíc k obsahu –
 * aby rezervace krátkých volání nepodstřelila.
 */
export const MESSAGE_OVERHEAD_TOKENS = 200;

/**
 * Kredity, které se před voláním LLM rezervují (BIL-1): nejvyšší možná cena
 * volání – vstup podle odhadu, výstup celý `max_tokens` – přes všechny modely,
 * které můžou odpovědět (primární i serverový fallback). Po volání se naúčtuje
 * skutečná spotřeba a zbytek rezervace se vrátí.
 */
export function reservationCredits(
  models: readonly string[],
  estimatedInputTokens: number,
  maxOutputTokens: number,
): number {
  if (models.length === 0) throw new Error('reservationCredits: chybí model');
  const input = Math.max(0, estimatedInputTokens) + MESSAGE_OVERHEAD_TOKENS;
  return Math.max(
    ...models.map((model) => creditsForUsage(model, input, Math.max(0, maxOutputTokens))),
  );
}

/** Kredity za dobití částky v haléřích. */
export function czkToCredits(amountHalire: number): number {
  return Math.floor((amountHalire / 100 / BILLING.creditPriceCzkPerMillion) * 1_000_000);
}

/** Hodnota kreditů v Kč. */
export function creditsToCzk(credits: number): number {
  return (credits / 1_000_000) * BILLING.creditPriceCzkPerMillion;
}
