import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { parseOcrJson } from '@ai-sedlacek/ocr';
import { createVersion } from '@/lib/infrastructure/versioning';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Re-parse a document from its stored rawResponse without calling the LLM again.
 * Returns the updated document if successful, or 422 if parsing still fails.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

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

  // Předchozí obsah uložit jako verze – reparse přepisuje i ručně upravený
  // kontext, který se dřív ztrácel bez historie.
  const lang = parsed.translationLanguage || 'cs';
  const existingTranslation = await prisma.translation.findUnique({
    where: { documentId_language: { documentId: id, language: lang } },
  });
  const model = doc.model ?? undefined;
  if (doc.transcription !== parsed.transcription) {
    await createVersion(id, 'transcription', doc.transcription, 'ai_regenerate', model);
  }
  if (doc.context && doc.context !== parsed.context) {
    await createVersion(id, 'context', doc.context, 'ai_regenerate', model);
  }
  if (existingTranslation && existingTranslation.text !== parsed.translation) {
    await createVersion(
      id,
      `translation:${lang}`,
      existingTranslation.text,
      'ai_regenerate',
      model,
    );
  }

  // Zápis atomicky – při selhání uprostřed nesmí zůstat dokument bez glosáře
  // nebo s novým přepisem a starým překladem.
  await prisma.$transaction([
    prisma.document.update({
      where: { id },
      data: {
        transcription: parsed.transcription,
        detectedLanguage: parsed.detectedLanguage,
        context: parsed.context,
      },
    }),
    prisma.translation.upsert({
      where: { documentId_language: { documentId: id, language: lang } },
      update: { text: parsed.translation },
      create: { documentId: id, language: lang, text: parsed.translation },
    }),
    prisma.glossaryEntry.deleteMany({ where: { documentId: id } }),
    prisma.glossaryEntry.createMany({
      data: parsed.glossary.map((g) => ({
        documentId: id,
        term: g.term,
        definition: g.definition,
      })),
    }),
  ]);

  // Mark page as done – archivovanou („smazanou") stránku nechat archivovanou.
  await prisma.page.updateMany({
    where: { id: doc.page.id, status: { not: 'archived' } },
    data: { status: 'done', errorMessage: null },
  });

  return NextResponse.json({ ok: true, reparsed: true });
}
