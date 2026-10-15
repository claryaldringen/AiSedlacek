import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: { collection: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));

import { getPublicCollectionCards } from '../public-collections';

const base = { slug: 'svazek', context: 'Kontext' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPublicCollectionCards', () => {
  it('uses the thumbnail for the card cover, the original only as a fallback', async () => {
    mockFindMany.mockResolvedValue([
      {
        ...base,
        id: 'c1',
        name: 'S náhledem',
        pages: [{ imageUrl: '/uploads/a.jpg', thumbnailUrl: '/uploads/a_thumb.jpg' }],
        _count: { pages: 12 },
      },
      {
        ...base,
        id: 'c2',
        name: 'Bez náhledu',
        pages: [{ imageUrl: '/uploads/b.jpg', thumbnailUrl: null }],
        _count: { pages: 1 },
      },
    ]);

    const cards = await getPublicCollectionCards('cs');

    expect(cards.map((c) => [c.id, c.coverUrl, c.pageCount])).toEqual([
      ['c1', '/uploads/a_thumb.jpg', 12],
      ['c2', '/uploads/b.jpg', 1],
    ]);
  });

  it('skips collections without a translated page in the locale', async () => {
    mockFindMany.mockResolvedValue([
      { ...base, id: 'c1', name: 'Prázdný', pages: [], _count: { pages: 0 } },
    ]);

    expect(await getPublicCollectionCards('en')).toEqual([]);
  });

  it('loads only the first page per collection and counts the rest in the DB', async () => {
    mockFindMany.mockResolvedValue([]);

    await getPublicCollectionCards('de');

    const shownPage = {
      status: 'done',
      document: { translations: { some: { language: 'de' } } },
    };
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isPublic: true },
      select: expect.objectContaining({
        pages: {
          where: shownPage,
          orderBy: { order: 'asc' },
          take: 1,
          select: { imageUrl: true, thumbnailUrl: true },
        },
        _count: { select: { pages: { where: shownPage } } },
      }),
    });
  });
});
