import { describe, it, expect } from 'vitest';
import { chargeForUsage, formatCzk } from '../pricing';
import { creditsForUsage } from '@ai-sedlacek/shared';

describe('UI pricing', () => {
  it('shows exactly what billing charges', () => {
    const charge = chargeForUsage('claude-opus-5-5', 3000, 3300);
    expect(charge?.credits).toBe(creditsForUsage('claude-opus-5-5', 3000, 3300));
    // 3000 × $4 + 3300 × $20 = $0.078 → × 23 Kč × 2 = 3.588 Kč
    expect(charge?.czk).toBeCloseTo(3.588);
  });

  it('returns null without usage', () => {
    expect(chargeForUsage('claude-opus-5-5', 0, 0)).toBeNull();
    expect(chargeForUsage('claude-opus-5-5', null, undefined)).toBeNull();
  });

  it('formats CZK', () => {
    expect(formatCzk(3.588, 'en')).toBe('3.59');
    expect(formatCzk(0.0042, 'en')).toBe('0.0042');
  });
});
