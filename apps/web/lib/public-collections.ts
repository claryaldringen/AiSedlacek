import { prisma } from '@/lib/infrastructure/db';

export interface PublicCollectionCard {
  id: string;
  name: string;
  slug: string | null;
  context: string | null;
  /** Obrázek na kartu – náhled (400 px), originál jen když náhled chybí. */
  coverUrl: string;
  /** Počet zpracovaných stránek s překladem v daném jazyce. */
  pageCount: number;
}

/**
 * Veřejné svazky pro úvodní stránku. Na kartě je jen titulní obrázek, takže se
 * načítá náhled (originál skenu má jednotky až desítky MB) a jen první stránka –
 * počet stránek spočítá DB.
 */
export async function getPublicCollectionCards(locale: string): Promise<PublicCollectionCard[]> {
  const shownPage = {
    status: 'done',
    document: { translations: { some: { language: locale } } },
  };

  const collections = await prisma.collection.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      slug: true,
      context: true,
      pages: {
        where: shownPage,
        orderBy: { order: 'asc' },
        take: 1,
        select: { imageUrl: true, thumbnailUrl: true },
      },
      _count: { select: { pages: { where: shownPage } } },
    },
  });

  return collections.flatMap((c) => {
    const cover = c.pages[0];
    if (!cover) return [];
    return [
      {
        id: c.id,
        name: c.name,
        slug: c.slug,
        context: c.context,
        coverUrl: cover.thumbnailUrl ?? cover.imageUrl,
        pageCount: c._count.pages,
      },
    ];
  });
}
