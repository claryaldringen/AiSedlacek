import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/workspace/', '/api/', '/login'],
    },
    sitemap: `${process.env.NEXTAUTH_URL ?? 'https://aisedlacek.cz'}/sitemap.xml`,
  };
}
