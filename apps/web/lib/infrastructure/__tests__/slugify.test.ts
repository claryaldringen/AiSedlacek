import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    publicSlug: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { slugify, generateUniqueSlug } from '../slugify';

describe('slugify', () => {
  it('converts text to lowercase slug', () => {
    expect(slugify('Jenský kodex')).toBe('jensky-kodex');
  });

  it('handles diacritics', () => {
    expect(slugify('Příběhy z Čech')).toBe('pribehy-z-cech');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo   ---  bar')).toBe('foo-bar');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--foo--')).toBe('foo');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it('returns fallback for empty input', () => {
    expect(slugify('')).toBe('shared');
  });
});

describe('generateUniqueSlug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns base slug when available', async () => {
    mockFindUnique.mockResolvedValue(null);
    const slug = await generateUniqueSlug('Jenský kodex');
    expect(slug).toBe('jensky-kodex');
  });

  it('appends suffix on collision', async () => {
    mockFindUnique.mockResolvedValueOnce({ slug: 'jensky-kodex' }).mockResolvedValueOnce(null);
    const slug = await generateUniqueSlug('Jenský kodex');
    expect(slug).toBe('jensky-kodex-2');
  });
});
