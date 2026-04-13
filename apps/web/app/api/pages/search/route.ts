import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const collectionId = searchParams.get('collectionId');

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const pages = await prisma.page.findMany({
    where: {
      userId,
      status: { not: 'archived' },
      ...(collectionId ? { collectionId } : {}),
      document: {
        OR: [
          { transcription: { contains: q, mode: 'insensitive' } },
          { translations: { some: { text: { contains: q, mode: 'insensitive' } } } },
        ],
      },
    },
    select: {
      id: true,
      filename: true,
      displayName: true,
      collectionId: true,
      collection: { select: { name: true } },
      document: {
        select: {
          transcription: true,
          translations: { select: { text: true } },
        },
      },
    },
  });

  const results = pages.map((page) => {
    const transcription = page.document?.transcription ?? '';
    const translationTexts = page.document?.translations.map((t) => t.text) ?? [];
    const allText = [transcription, ...translationTexts].join(' ');

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = (allText.match(regex) ?? []).length;

    const lowerAll = allText.toLowerCase();
    const idx = lowerAll.indexOf(q.toLowerCase());
    let snippet = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 50);
      const end = Math.min(allText.length, idx + q.length + 50);
      snippet =
        (start > 0 ? '…' : '') +
        allText.slice(start, end) +
        (end < allText.length ? '…' : '');
    }

    return {
      pageId: page.id,
      filename: page.filename,
      displayName: page.displayName,
      collectionId: page.collectionId,
      collectionName: page.collection?.name ?? null,
      matches,
      snippet,
    };
  });

  return NextResponse.json({ results });
}
