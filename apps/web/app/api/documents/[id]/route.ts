import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: t('notLoggedIn') }, { status: 401 });
  }

  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { translations: true, glossary: true, page: { select: { userId: true } } },
  });

  if (!doc || doc.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  return NextResponse.json(doc);
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: t('notLoggedIn') }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { transcription, translation, translationLanguage, context } = body as {
    transcription?: string;
    translation?: string;
    translationLanguage?: string;
    context?: string;
  };

  // Fetch current state for versioning and ownership check
  const current = await prisma.document.findUnique({
    where: { id },
    include: { translations: true, page: { select: { userId: true } } },
  });
  if (!current || current.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  const data: Record<string, string> = {};

  if (typeof transcription === 'string' && transcription !== current.transcription) {
    await createVersion(id, 'transcription', current.transcription, 'manual_edit');
    data.transcription = transcription;
  }
  if (typeof context === 'string' && context !== current.context) {
    await createVersion(id, 'context', current.context, 'manual_edit');
    data.context = context;
  }

  if (Object.keys(data).length > 0) {
    await prisma.document.update({ where: { id }, data });
  }

  // Update translation if provided
  if (typeof translation === 'string' && typeof translationLanguage === 'string') {
    const existingTranslation = current.translations.find(
      (t) => t.language === translationLanguage,
    );
    if (existingTranslation && existingTranslation.text !== translation) {
      await createVersion(
        id,
        `translation:${translationLanguage}`,
        existingTranslation.text,
        'manual_edit',
      );
    }
    await prisma.translation.upsert({
      where: { documentId_language: { documentId: id, language: translationLanguage } },
      update: { text: translation },
      create: { documentId: id, language: translationLanguage, text: translation },
    });
  }

  const updated = await prisma.document.findUnique({
    where: { id },
    include: { translations: true, glossary: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: t('notLoggedIn') }, { status: 401 });
  }

  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { page: { select: { userId: true } } },
  });
  if (!doc || doc.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  try {
    await prisma.document.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }
}
