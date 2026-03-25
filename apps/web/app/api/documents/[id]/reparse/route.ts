import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { parseOcrJson } from '@ai-sedlacek/ocr';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Re-parse a document from its stored rawResponse without calling the LLM again.
 * Returns the updated document if successful, or 422 if parsing still fails.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
    include: { page: { select: { id: true, userId: true } } },
  });

  if (!doc || doc.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  if (!doc.rawResponse) {
    return NextResponse.json({ error: t('noRawResponse') }, { status: 422 });
  }

  let parsed;
  try {
    parsed = parseOcrJson(doc.rawResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : t('serverError');
    return NextResponse.json({ error: `Re-parse selhal: ${message}` }, { status: 422 });
  }

  // Save old transcription as version
  await createVersion(
    id,
    'transcription',
    doc.transcription,
    'ai_regenerate',
    doc.model ?? undefined,
  );

  // Update document with re-parsed data
  await prisma.document.update({
    where: { id },
    data: {
      transcription: parsed.transcription,
      detectedLanguage: parsed.detectedLanguage,
      context: parsed.context,
    },
  });

  // Upsert translation
  const lang = parsed.translationLanguage || 'cs';
  const existingTranslation = await prisma.translation.findUnique({
    where: { documentId_language: { documentId: id, language: lang } },
  });
  if (existingTranslation) {
    await createVersion(
      id,
      `translation:${lang}`,
      existingTranslation.text,
      'ai_regenerate',
      doc.model ?? undefined,
    );
  }
  await prisma.translation.upsert({
    where: { documentId_language: { documentId: id, language: lang } },
    update: { text: parsed.translation },
    create: { documentId: id, language: lang, text: parsed.translation },
  });

  // Update glossary
  await prisma.glossaryEntry.deleteMany({ where: { documentId: id } });
  if (parsed.glossary.length > 0) {
    await prisma.glossaryEntry.createMany({
      data: parsed.glossary.map((g) => ({
        documentId: id,
        term: g.term,
        definition: g.definition,
      })),
    });
  }

  // Mark page as done
  await prisma.page.update({
    where: { id: doc.page.id },
    data: { status: 'done', errorMessage: null },
  });

  return NextResponse.json({ ok: true, reparsed: true });
}
