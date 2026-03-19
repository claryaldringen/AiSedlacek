import { describe, it, expect } from 'vitest';
import { estimateImageTokens, createBatches, truncateContext } from '../batch-utils';

describe('estimateImageTokens', () => {
  it('estimates tokens from file size', () => {
    // 400KB image: 400000/750 + 258 = 791
    expect(estimateImageTokens(400_000)).toBeCloseTo(791, 0);
  });

  it('handles small images', () => {
    expect(estimateImageTokens(1000)).toBeCloseTo(259, 0);
  });
});

describe('createBatches', () => {
  const makePage = (id: string, fileSize: number) => ({ id, fileSize });

  it('puts all pages in one batch when under budget', () => {
    const pages = [makePage('a', 400_000), makePage('b', 400_000)];
    const batches = createBatches(pages, {
      inputTokenBudget: 150_000,
      maxOutputTokens: 16384,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('splits into multiple batches when over input budget', () => {
    // Each page ~100K tokens → only 1 per batch with 150K budget
    const pages = [makePage('a', 75_000_000), makePage('b', 75_000_000)];
    const batches = createBatches(pages, {
      inputTokenBudget: 150_000,
      maxOutputTokens: 16384,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(2);
  });

  it('splits by output budget', () => {
    // Small images but maxOutputTokens only allows 2 pages (5000/2500=2)
    const pages = [makePage('a', 1000), makePage('b', 1000), makePage('c', 1000)];
    const batches = createBatches(pages, {
      inputTokenBudget: 150_000,
      maxOutputTokens: 5000,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it('handles single page', () => {
    const pages = [makePage('a', 400_000)];
    const batches = createBatches(pages, {
      inputTokenBudget: 150_000,
      maxOutputTokens: 16384,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(1);
  });

  it('handles empty input', () => {
    const batches = createBatches([], {
      inputTokenBudget: 150_000,
      maxOutputTokens: 16384,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(0);
  });

  it('ensures at least 1 page per batch even if over budget', () => {
    const pages = [makePage('a', 200_000_000)];
    const batches = createBatches(pages, {
      inputTokenBudget: 150_000,
      maxOutputTokens: 16384,
      avgOutputPerPage: 2500,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });
});

describe('truncateContext', () => {
  it('returns text as-is if under limit', () => {
    const text = 'Short text';
    expect(truncateContext(text, 500)).toBe(text);
  });

  it('truncates long text to approximate token limit', () => {
    // ~4 chars per token, 500 tokens ≈ 2000 chars
    const longText = 'A'.repeat(5000);
    const result = truncateContext(longText, 500);
    expect(result!.length).toBeLessThanOrEqual(2001); // 2000 + '…'
    expect(result!.endsWith('…')).toBe(true);
  });

  it('returns undefined for empty input', () => {
    expect(truncateContext('', 500)).toBeUndefined();
    expect(truncateContext(undefined, 500)).toBeUndefined();
  });
});
