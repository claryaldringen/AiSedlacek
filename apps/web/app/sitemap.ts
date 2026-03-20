import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/infrastructure/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://aisedlacek.cz';

  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
  ];

  try {
    const publicSlugs = await prisma.publicSlug.findMany({
      where: { targetType: 'collection' },
      select: { slug: true, createdAt: true },
    });

    for (const ps of publicSlugs) {
      entries.push({
        url: `${baseUrl}/view/${ps.slug}`,
        lastModified: ps.createdAt,
        changeFrequency: 'monthly',
        priority: 0.8,
      });
    }
  } catch {
    // DB not available during build
  }

  return entries;
}
