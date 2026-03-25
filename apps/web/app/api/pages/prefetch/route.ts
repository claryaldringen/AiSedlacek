import { NextRequest, NextResponse } from 'next/server';
import { prefetch } from '@/lib/infrastructure/prefetch-cache';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

/**
 * Fire-and-forget prefetch — client calls this for discovered URLs
 * so they're already downloaded when import starts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { urls } = (body ?? {}) as { urls?: string[] };
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: t('missingUrls') }, { status: 400 });
  }

  // Trigger background downloads (non-blocking)
  for (const url of urls.slice(0, 50)) {
    if (typeof url === 'string' && url.startsWith('http')) {
      prefetch(url);
    }
  }

  return NextResponse.json({ queued: urls.length });
}
