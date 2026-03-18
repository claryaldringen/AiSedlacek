import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const collectionId = searchParams.get('collectionId');

  const pages = await prisma.page.findMany({
    where: {
      userId,
      status: { not: 'archived' },
      ...(collectionId ? { collectionId } : { collectionId: null }),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: {
      document: {
        select: {
          id: true,
          detectedLanguage: true,
          translations: { select: { language: true } },
        },
      },
    },
  });

  return NextResponse.json(pages);
}
