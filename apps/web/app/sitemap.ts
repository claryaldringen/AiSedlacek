import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/infrastructure/db';

const locales = ['en', 'cs'] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://aisedlacek.cz';

  const entries: MetadataRoute.Sitemap = locales.map((locale) => ({
    url: `${baseUrl}/${locale}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 1,
  }));

  try {
    const publicSlugs = await prisma.publicSlug.findMany({
      where: { targetType: 'collection' },
      select: { slug: true, createdAt: true },
    });

    for (const ps of publicSlugs) {
      for (const locale of locales) {
        entries.push({
          url: `${baseUrl}/${locale}/view/${ps.slug}`,
          lastModified: ps.createdAt,
          changeFrequency: 'monthly',
          priority: 0.8,
        });
      }
    }
  } catch {
    // DB not available during build
  }

  return entries;
}
