import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { canReadPage } from '@/lib/infrastructure/authz';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  // Historii verzí smí číst vlastník a členové sdíleného workspace (obnova verze
  // je PATCH dokumentu – ten dál smí jen vlastník). Veřejnost stránky/svazku
  // nestačí: historie může obsahovat text, který vlastník před zveřejněním smazal.
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      page: {
        select: { id: true, userId: true, isPublic: true, status: true, collectionId: true },
      },
    },
  });
  if (!doc || !(await canReadPage(userId, doc.page, { allowPublic: false }))) {
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
