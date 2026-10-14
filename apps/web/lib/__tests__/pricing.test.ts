import { describe, it, expect } from 'vitest';
import { computeCostRaw, computeCostFromTokens, MODEL_PRICING } from '../pricing';

describe('pricing', () => {
  it('uses current Opus 4.6 rates ($5/$25 per MTok)', () => {
    expect(MODEL_PRICING['claude-opus-4-6']).toEqual({ input: 5, output: 25 });
    // 1M vstupních + 1M výstupních tokenů × multiplikátor 2
    expect(computeCostRaw('claude-opus-4-6', 1_000_000, 1_000_000)).toBe(60);
  });

  it('knows the current model generation', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      expect(computeCostRaw(model, 1000, 1000), model).toBeGreaterThan(0);
    }
  });

  it('collection aggregates default to Opus 4.6 rates', () => {
    expect(computeCostFromTokens(1_000_000, 0)).toBe(10);
  });
});
