import { describe, it, expect } from 'vitest';
import { BILLING, creditsForUsage, czkToCredits, modelRates, usagePriceCzk } from '../pricing';

describe('pricing', () => {
  it('charges the actual API cost × markup, per model and token direction', () => {
    // Opus 5.5: $4 / $20 za 1M → 1M výstupních tokenů = $20 → × 23 Kč × 2 = 920 Kč
    expect(usagePriceCzk('claude-opus-5-5', 0, 1_000_000)).toBeCloseTo(
      20 * BILLING.usdToCzk * BILLING.markup,
    );
    // výstup je u Opusu 5× dražší než vstup
    expect(creditsForUsage('claude-opus-5-5', 0, 1000)).toBe(
      5 * creditsForUsage('claude-opus-5-5', 1000, 0),
    );
  });

  it('typical OCR page on Opus 5.5 costs a few CZK, not a fraction', () => {
    const credits = creditsForUsage('claude-opus-5-5', 3000, 3300);
    // 3000 × $4 + 3300 × $20 = $0.078 → × 23 × 2 ≈ 3.59 Kč ≈ 71 760 kreditů
    expect(credits).toBeGreaterThan(70_000);
    expect(credits).toBeLessThan(73_000);
  });

  it('never undercharges an unknown model', () => {
    expect(modelRates('claude-something-new')).toEqual({ input: 15, output: 75 });
    expect(modelRates('claude-opus-5-5-20261001')).toEqual(modelRates('claude-opus-5-5'));
  });

  it('charges nothing for zero usage (claude-cli / ais submit)', () => {
    expect(creditsForUsage('claude-agent-cli', 0, 0)).toBe(0);
  });

  it('keeps the top-up rate of 50 CZK per 1M credits', () => {
    expect(czkToCredits(100 * 100)).toBe(2_000_000);
  });
});
