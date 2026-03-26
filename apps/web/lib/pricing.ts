/**
 * Model pricing constants and cost calculation utilities.
 *
 * Centralized pricing for Claude models so that both UI components
 * (ResultViewer) and API routes (collections) use the same rates.
 */

// Token multiplier applied to display values (billing uses the same multiplier)
export const TOKEN_MULTIPLIER = parseInt(process.env.TOKEN_MULTIPLIER ?? '2');

// Pricing per million tokens (USD), May 2025
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
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
 * Default rates correspond to Claude Opus: $15/1M input, $75/1M output.
 */
export function computeCostFromTokens(
  inputTokens: number,
  outputTokens: number,
  inputRate: number = 15,
  outputRate: number = 75,
): number {
  return (
    (inputTokens * TOKEN_MULTIPLIER * inputRate + outputTokens * TOKEN_MULTIPLIER * outputRate) /
    1_000_000
  );
}
