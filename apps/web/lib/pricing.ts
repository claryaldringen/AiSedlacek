/**
 * Model pricing constants and cost calculation utilities.
 *
 * Centralized pricing for Claude models so that both UI components
 * (ResultViewer) and API routes (collections) use the same rates.
 */

// Token multiplier applied to display values (billing uses the same multiplier)
export const TOKEN_MULTIPLIER = parseInt(process.env.TOKEN_MULTIPLIER ?? '2');

// Ceny za milion tokenů (USD) podle ceníku Anthropic k 2026-10-06. Slouží jen
// pro zobrazení nákladů v UI – kredity účtuje packages/db/src/billing.ts.
// (Opus 4.6 tu dřív byl za $15/$75 – cenu Opus 4 – a UI ukazovalo ~3× víc.)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Compute the raw USD cost for a model invocation.
 * Returns 0 when model or token counts are missing/unknown.
 */
export function computeCostRaw(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  if (!model || inputTokens == null || outputTokens == null) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (
    ((inputTokens * TOKEN_MULTIPLIER) / 1_000_000) * pricing.input +
    ((outputTokens * TOKEN_MULTIPLIER) / 1_000_000) * pricing.output
  );
}

/**
 * Format a cost as a human-readable dollar string, or return null when cost is zero.
 */
export function formatCost(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): string | null {
  const cost = computeCostRaw(model, inputTokens, outputTokens);
  if (cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/**
 * Compute the USD cost using raw token counts and a fallback pricing rate
 * (useful when the model name is not stored per-row, e.g. collection aggregates).
 *
 * Default rates correspond to the OCR model Claude Opus 4.6: $5/1M input, $25/1M output.
 */
export function computeCostFromTokens(
  inputTokens: number,
  outputTokens: number,
  inputRate: number = MODEL_PRICING['claude-opus-4-6']!.input,
  outputRate: number = MODEL_PRICING['claude-opus-4-6']!.output,
): number {
  return (
    (inputTokens * TOKEN_MULTIPLIER * inputRate + outputTokens * TOKEN_MULTIPLIER * outputRate) /
    1_000_000
  );
}
