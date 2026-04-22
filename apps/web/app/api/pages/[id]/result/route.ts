import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  // Verify page ownership
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.userId !== userId) {
    return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
  }

  if (page.status === 'done') {
    return NextResponse.json(
      { error: 'Stránka už byla zpracována' },
      { status: 409 },
    );
  }

  const body = await request.json();
  const {
    transcription,
    detectedLanguage,
    translation,
    translationLanguage,
    context,
    glossary,
    model,
    processingTimeMs,
  } = body;

  if (!transcription || !translation) {
    return NextResponse.json(
      { error: 'transcription a translation jsou povinné' },
      { status: 400 },
    );
  }

  // Create document
  const document = await prisma.document.create({
    data: {
      pageId: id,
      hash: page.hash,
      transcription,
      detectedLanguage: detectedLanguage ?? 'unknown',
      context: context ?? '',
      model: model ?? 'claude-cli',
      processingTimeMs: processingTimeMs ?? null,
    },
  });

  // Create translation
  await prisma.translation.create({
    data: {
      documentId: document.id,
      language: translationLanguage ?? 'cs',
      text: translation,
      context: context ?? '',
    },
  });

  // Create glossary entries
  if (Array.isArray(glossary) && glossary.length > 0) {
    await prisma.glossaryEntry.createMany({
      data: glossary.map((g: { term: string; definition: string }) => ({
        documentId: document.id,
        term: g.term,
        definition: g.definition,
      })),
    });
  }

  // Create initial versions
  await createVersion(document.id, 'transcription', transcription, 'ai_initial', model);
  await createVersion(
    document.id,
    `translation:${translationLanguage ?? 'cs'}`,
    translation,
    'ai_initial',
    model,
  );
  if (context) {
    await createVersion(document.id, 'context', context, 'ai_initial', model);
  }

  // Update page status
  await prisma.page.update({
    where: { id },
    data: { status: 'done' },
  });

  return NextResponse.json({
    documentId: document.id,
    status: 'done',
  });
}
