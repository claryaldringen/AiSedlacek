import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

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
