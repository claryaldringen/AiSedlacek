import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollectionFindMany = vi.fn();
const mockQueryRaw = vi.fn();
const mockGroupBy = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: { findMany: (...args: unknown[]) => mockCollectionFindMany(...args) },
    page: { groupBy: (...args: unknown[]) => mockGroupBy(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { getPublicCollectionCards } from '../public-collections';

const collection = (id: string, name: string) => ({ id, name, slug: id, context: 'Kontext' });

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryRaw.mockResolvedValue([]);
  mockGroupBy.mockResolvedValue([]);
});

describe('getPublicCollectionCards', () => {
  it('uses the thumbnail for the card cover, the original only as a fallback', async () => {
    mockCollectionFindMany.mockResolvedValue([
      collection('c1', 'S náhledem'),
      collection('c2', 'Bez náhledu'),
    ]);
    mockQueryRaw.mockResolvedValue([
      { collectionId: 'c1', imageUrl: '/uploads/a.jpg', thumbnailUrl: '/uploads/a_thumb.jpg' },
      { collectionId: 'c2', imageUrl: '/uploads/b.jpg', thumbnailUrl: null },
    ]);
    mockGroupBy.mockResolvedValue([
      { collectionId: 'c1', _count: { _all: 12 } },
      { collectionId: 'c2', _count: { _all: 1 } },
    ]);

    const cards = await getPublicCollectionCards('cs');

    expect(cards.map((c) => [c.id, c.coverUrl, c.pageCount])).toEqual([
      ['c1', '/uploads/a_thumb.jpg', 12],
      ['c2', '/uploads/b.jpg', 1],
    ]);
  });

  it('skips collections without a translated page in the locale', async () => {
    mockCollectionFindMany.mockResolvedValue([collection('c1', 'Prázdný')]);

    expect(await getPublicCollectionCards('en')).toEqual([]);
  });

  it('without public collections does not query pages at all', async () => {
    mockCollectionFindMany.mockResolvedValue([]);

    expect(await getPublicCollectionCards('cs')).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it('restricts cover and count queries to the public collections', async () => {
    mockCollectionFindMany.mockResolvedValue([collection('c1', 'A'), collection('c2', 'B')]);

    await getPublicCollectionCards('de');

    expect(mockCollectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isPublic: true } }),
    );
    // Titulní stránka: jedna na svazek přímo v DB, deterministické pořadí
    const sql = mockQueryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('DISTINCT ON (p."collectionId")');
    expect(sql.sql).toContain('ORDER BY p."collectionId", p."order", p."createdAt"');
    expect(sql.values).toEqual(['c1', 'c2', 'de']);
    // Počet: jen stránky veřejných svazků (ne agregace přes celou DB)
    expect(mockGroupBy).toHaveBeenCalledWith({
      by: ['collectionId'],
      where: {
        collectionId: { in: ['c1', 'c2'] },
        status: 'done',
        document: { translations: { some: { language: 'de' } } },
      },
      _count: { _all: true },
    });
  });
});
