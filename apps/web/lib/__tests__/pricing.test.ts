import { describe, it, expect } from 'vitest';
import { chargeForUsage, formatCzk, documentCharge } from '../pricing';
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

describe('documentCharge (BIL-11)', () => {
  it('ukazuje skutečný odečet, pokud je uložený – i když ceník mezitím zdražil', () => {
    // 20 000 kreditů = 1 Kč bez ohledu na tokeny a model
    expect(documentCharge(20_000, 'claude-opus-5-5', 3000, 3300)).toEqual({
      czk: 1,
      credits: 20_000,
      estimated: false,
    });
  });

  it('starší dokument bez záznamu odečtu ukáže odhad podle aktuálního ceníku', () => {
    const charge = documentCharge(null, 'claude-opus-5-5', 1000, 500);
    expect(charge).toMatchObject({ credits: 12_880, estimated: true });
  });

  it('bez záznamu i bez tokenů nic neukáže', () => {
    expect(documentCharge(undefined, null, null, null)).toBeNull();
  });

  it('nulový odečet (kopie překladu) je skutečná cena 0', () => {
    expect(documentCharge(0, 'claude-sonnet-4-6', 100, 50)).toEqual({
      czk: 0,
      credits: 0,
      estimated: false,
    });
  });
});
