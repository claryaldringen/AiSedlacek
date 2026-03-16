import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const collectionId = searchParams.get('collectionId');

  const pages = await prisma.page.findMany({
    where: collectionId ? { collectionId } : undefined,
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
