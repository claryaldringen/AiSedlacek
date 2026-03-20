import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { isBlankPage } from '@/lib/infrastructure/blank-detection';
import { getStorage } from '@/lib/adapters/storage';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { pageIds } = (body ?? {}) as { pageIds?: string[] };
  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return NextResponse.json({ error: 'Chybí pageIds' }, { status: 400 });
  }

  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds }, userId, status: 'pending' },
    select: { id: true, imageUrl: true },
  });

  const results: { pageId: string; blank: boolean }[] = [];

  for (const page of pages) {
    try {
      const storage = getStorage();
      const storagePath = page.imageUrl.startsWith('/api/images/')
        ? page.imageUrl.replace('/api/images/', '')
        : page.imageUrl;
      const buffer = await storage.read(storagePath);
      const blank = await isBlankPage(buffer);

      if (blank) {
        await prisma.page.update({
          where: { id: page.id },
          data: { status: 'blank' },
        });
      }

      results.push({ pageId: page.id, blank });
    } catch {
      results.push({ pageId: page.id, blank: false });
    }
  }

  return NextResponse.json({ results });
}
