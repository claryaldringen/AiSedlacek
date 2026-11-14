import { describe, it, expect } from 'vitest';
import { chargeForUsage, formatCzk, documentCharge, resultCharges } from '../pricing';
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

describe('resultCharges – ceny v panelu metadat', () => {
  const result = {
    chargedCredits: null,
    model: 'claude-opus-5-5',
    inputTokens: 1000,
    outputTokens: 500,
    chatModel: 'claude-sonnet-4-6',
    chatInputTokens: 100,
    chatOutputTokens: 50,
    // Skutečně odečteno (server v SSE) – méně než 966 podle tokenů, kredit nestačil
    chatChargedCredits: 900,
  };

  it('chat ukazuje skutečně odečtené kredity ze serveru, ne cenu podle tokenů', () => {
    const charges = resultCharges(result, false);
    expect(charges.chat).toEqual({ czk: 0.045, credits: 900, estimated: false });
    // Starý dokument bez záznamu odečtu je odhad, a tím i celkem
    expect(charges.ocr).toMatchObject({ credits: 12_880, estimated: true });
    expect(charges.total).toMatchObject({ credits: 12_880 + 900, estimated: true });
  });

  it('se skutečným odečtem dokumentu není odhad ani celkem', () => {
    const charges = resultCharges({ ...result, chargedCredits: 12_000 }, false);
    expect(charges.total).toMatchObject({ credits: 12_900, estimated: false });
  });

  it('odpověď bez známého odečtu (spadlé spojení): cena chatu i celkem je neúplná', () => {
    const charges = resultCharges(
      { ...result, chargedCredits: 12_000, chatChargeIncomplete: true },
      false,
    );
    expect(charges.chat).toMatchObject({ credits: 900, incomplete: true, estimated: false });
    expect(charges.total).toMatchObject({ credits: 12_900, incomplete: true });
    // I bez jakéhokoli známého odečtu se chat ukáže – jako neúplný
    expect(resultCharges({ chatChargeIncomplete: true, chatInputTokens: 0 }, false).chat).toEqual({
      czk: 0,
      credits: 0,
      estimated: false,
      incomplete: true,
    });
  });

  it('starší server bez odečtu v SSE: cena chatu odhadem z tokenů (označená)', () => {
    const charges = resultCharges({ ...result, chatChargedCredits: undefined }, false);
    expect(charges.chat).toMatchObject({ credits: 966, estimated: true });
  });

  it('cizí dokument (jen pro čtení) ceny nezobrazuje', () => {
    expect(resultCharges(result, true)).toEqual({
      ocr: null,
      translation: null,
      chat: null,
      total: null,
    });
  });
});
