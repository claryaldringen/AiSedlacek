import { describe, it, expect } from 'vitest';

import { naturalCompare } from '../natural-sort';

describe('naturalCompare', () => {
  it('sorts pure numeric filenames: 1.jpg < 2.jpg < 10.jpg', () => {
    const input = ['10.jpg', '2.jpg', '1.jpg'];
    const sorted = [...input].sort(naturalCompare);
    expect(sorted).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('sorts filenames with text prefix: page1 < page2 < page10', () => {
    const input = ['page10.jpg', 'page2.jpg', 'page1.jpg'];
    const sorted = [...input].sort(naturalCompare);
    expect(sorted).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg']);
  });

  it('sorts numbers before letters', () => {
    const input = ['b.jpg', 'a.jpg', '2.jpg', '10.jpg', '1.jpg'];
    const sorted = [...input].sort(naturalCompare);
    expect(sorted).toEqual(['1.jpg', '2.jpg', '10.jpg', 'a.jpg', 'b.jpg']);
  });

  it('handles Czech locale ordering', () => {
    const input = ['č.jpg', 'c.jpg', 'd.jpg'];
    const sorted = [...input].sort(naturalCompare);
    // In Czech locale, c < č < d
    expect(sorted).toEqual(['c.jpg', 'č.jpg', 'd.jpg']);
  });

  it('handles identical strings', () => {
    expect(naturalCompare('foo.jpg', 'foo.jpg')).toBe(0);
  });

  it('handles multi-segment numbers: img2-3 < img2-10 < img10-1', () => {
    const input = ['img10-1.jpg', 'img2-10.jpg', 'img2-3.jpg'];
    const sorted = [...input].sort(naturalCompare);
    expect(sorted).toEqual(['img2-3.jpg', 'img2-10.jpg', 'img10-1.jpg']);
  });

  it('handles empty strings', () => {
    expect(naturalCompare('', 'a')).toBe(-1);
    expect(naturalCompare('a', '')).toBe(1);
    expect(naturalCompare('', '')).toBe(0);
  });
});
