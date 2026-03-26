import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  // Verify document ownership through page
  const doc = await prisma.document.findUnique({
    where: { id },
    include: { page: { select: { userId: true } } },
  });
  if (!doc || doc.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      field: true,
      source: true,
      model: true,
      createdAt: true,
      content: true,
    },
  });

  return NextResponse.json(versions);
}
