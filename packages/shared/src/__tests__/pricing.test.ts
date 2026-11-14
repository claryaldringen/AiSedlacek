import { describe, it, expect } from 'vitest';
import {
  BILLING,
  MESSAGE_OVERHEAD_TOKENS,
  creditsForUsage,
  czkToCredits,
  estimateInputTokens,
  isRefusalBilled,
  modelRates,
  reservationCredits,
  usagePriceCzk,
} from '../pricing';

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

describe('isRefusalBilled', () => {
  it('refusal mid-output is always billed', () => {
    expect(isRefusalBilled(15, null)).toBe(true);
    expect(isRefusalBilled(15, 'cyber')).toBe(true);
  });

  it('refusal before output is billed only in the billed categories', () => {
    expect(isRefusalBilled(0, 'bio')).toBe(true);
    expect(isRefusalBilled(0, 'frontier_llm')).toBe(true);
    expect(isRefusalBilled(0, 'reasoning_extraction')).toBe(true);
    expect(isRefusalBilled(0, 'cyber')).toBe(false);
    expect(isRefusalBilled(0, 'general_harms')).toBe(false);
    expect(isRefusalBilled(0, null)).toBe(false);
  });
});

describe('rezervace kreditu (BIL-1)', () => {
  it('odhad vstupu s rezervou: 2 bajty UTF-8 na token (čeština má víc bajtů)', () => {
    expect(estimateInputTokens('')).toBe(0);
    expect(estimateInputTokens('abcd')).toBe(2);
    // „ř" a „í" mají 2 bajty → 6 bajtů → 3 tokeny
    expect(estimateInputTokens('řík')).toBe(3);
  });

  it('rezervuje celý max_tokens nejvyšší sazbou z předaných modelů', () => {
    const credits = reservationCredits(['claude-opus-5-5', 'claude-opus-5'], 1000, 24_000);
    // Opus 5 ($5/$25) je dražší než Opus 5.5 ($4/$20) – rozhoduje jeho sazba
    expect(credits).toBe(creditsForUsage('claude-opus-5', 1000 + MESSAGE_OVERHEAD_TOKENS, 24_000));
    expect(credits).toBeGreaterThan(
      creditsForUsage('claude-opus-5-5', 1000 + MESSAGE_OVERHEAD_TOKENS, 24_000),
    );
  });

  it('rezervace pokryje jakoukoli spotřebu do max_tokens se vstupem do odhadu', () => {
    const hold = reservationCredits(['claude-sonnet-4-6'], 5000, 8192);
    expect(hold).toBeGreaterThanOrEqual(creditsForUsage('claude-sonnet-4-6', 5000, 8192));
  });
});
