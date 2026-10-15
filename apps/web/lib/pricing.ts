/**
 * Zobrazení nákladů v UI – stejný výpočet jako účtování kreditů
 * (`@ai-sedlacek/shared` pricing), aby UI ukazovalo, co uživatel skutečně platí.
 */
import { MODEL_PRICING_USD, creditsForUsage, usagePriceCzk } from '@ai-sedlacek/shared';

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

/** Částka v Kč na 2 desetinná místa (u velmi malých částek víc, ať není „0,00"). */
export function formatCzk(czk: number, locale: string): string {
  return czk.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: czk < 0.01 ? 4 : 2,
  });
}
