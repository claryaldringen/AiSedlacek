import { Prisma } from '@prisma/client';
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
 * Veřejné svazky pro úvodní stránku (veřejná URL, každá anonymní návštěva).
 * Na kartě je jen titulní obrázek, takže se bere náhled – originál skenu má
 * jednotky až desítky MB. Titulní stránku a počet stránek počítá DB jen nad
 * veřejnými svazky: filtrovaný `_count` i vnořené `take` by Prisma 6 vyřešila
 * agregací přes stránky celé DB, resp. ořízla až v paměti.
 */
export async function getPublicCollectionCards(locale: string): Promise<PublicCollectionCard[]> {
  const collections = await prisma.collection.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, slug: true, context: true },
  });
  if (collections.length === 0) return [];
  const ids = collections.map((c) => c.id);

  const [covers, counts] = await Promise.all([
    // Titulní stránka = první zobrazitelná podle pořadí; shodné `order` (např.
    // stránky z `ais upload`) rozhodne čas vzniku, ať se obálka nemění.
    prisma.$queryRaw<{ collectionId: string; imageUrl: string; thumbnailUrl: string | null }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (p."collectionId")
               p."collectionId" AS "collectionId",
               p."imageUrl" AS "imageUrl",
               p."thumbnailUrl" AS "thumbnailUrl"
        FROM "Page" p
        JOIN "Document" d ON d."pageId" = p."id"
        WHERE p."collectionId" IN (${Prisma.join(ids)})
          AND p."status" = 'done'
          AND EXISTS (
            SELECT 1 FROM "Translation" t
            WHERE t."documentId" = d."id" AND t."language" = ${locale}
          )
        ORDER BY p."collectionId", p."order", p."createdAt"
      `,
    ),
    prisma.page.groupBy({
      by: ['collectionId'],
      where: {
        collectionId: { in: ids },
        status: 'done',
        document: { translations: { some: { language: locale } } },
      },
      _count: { _all: true },
    }),
  ]);

  const coverById = new Map(covers.map((c) => [c.collectionId, c]));
  const countById = new Map(counts.map((c) => [c.collectionId, c._count._all]));

  return collections.flatMap((c) => {
    const cover = coverById.get(c.id);
    if (!cover) return [];
    return [
      {
        id: c.id,
        name: c.name,
        slug: c.slug,
        context: c.context,
        coverUrl: cover.thumbnailUrl ?? cover.imageUrl,
        pageCount: countById.get(c.id) ?? 0,
      },
    ];
  });
}
