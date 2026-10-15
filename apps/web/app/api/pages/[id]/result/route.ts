import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { isTranslationLanguage } from '@ai-sedlacek/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Validované tělo `ais submit` (agentní OCR bez placeného API). */
interface SubmittedResult {
  transcription: string;
  translation: string;
  translationLanguage: string;
  detectedLanguage: string | undefined;
  context: string | undefined;
  glossary: { term: string; definition: string }[];
  model: string | undefined;
  processingTimeMs: number | undefined;
}

const MAX_INT32 = 2_147_483_647;

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isGlossaryEntry(value: unknown): value is { term: string; definition: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { term?: unknown }).term === 'string' &&
    typeof (value as { definition?: unknown }).definition === 'string'
  );
}

/**
 * Ověří typy všech polí dřív, než se cokoli zapíše. Vrací název prvního
 * neplatného pole, nebo validovaný výsledek.
 */
function parseSubmittedResult(
  body: Record<string, unknown>,
): { ok: true; result: SubmittedResult } | { ok: false; field: string } {
  const {
    transcription,
    translation,
    translationLanguage,
    detectedLanguage,
    context,
    glossary,
    model,
    processingTimeMs,
  } = body;

  if (typeof transcription !== 'string') return { ok: false, field: 'transcription' };
  if (typeof translation !== 'string') return { ok: false, field: 'translation' };
  if (translationLanguage !== undefined && typeof translationLanguage !== 'string') {
    return { ok: false, field: 'translationLanguage' };
  }
  if (!isOptionalString(detectedLanguage)) return { ok: false, field: 'detectedLanguage' };
  if (!isOptionalString(context)) return { ok: false, field: 'context' };
  if (!isOptionalString(model)) return { ok: false, field: 'model' };
  if (
    glossary !== undefined &&
    glossary !== null &&
    !(Array.isArray(glossary) && glossary.every(isGlossaryEntry))
  ) {
    return { ok: false, field: 'glossary' };
  }
  if (
    processingTimeMs !== undefined &&
    processingTimeMs !== null &&
    !(
      typeof processingTimeMs === 'number' &&
      Number.isFinite(processingTimeMs) &&
      processingTimeMs >= 0 &&
      processingTimeMs <= MAX_INT32
    )
  ) {
    return { ok: false, field: 'processingTimeMs' };
  }

  return {
    ok: true,
    result: {
      transcription,
      translation,
      translationLanguage: translationLanguage ?? 'cs',
      detectedLanguage: detectedLanguage ?? undefined,
      context: context ?? undefined,
      glossary: Array.isArray(glossary)
        ? glossary.map((g: { term: string; definition: string }) => ({
            term: g.term,
            definition: g.definition,
          }))
        : [],
      model: model ?? undefined,
      // Sloupec je Int – desetinné milisekundy od agenta zaokrouhlíme.
      processingTimeMs:
        typeof processingTimeMs === 'number' ? Math.round(processingTimeMs) : undefined,
    },
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'P2002'
  );
}

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');
  const { id } = await params;

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  // Verify page ownership
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.userId !== userId) {
    return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
  }

  if (page.status === 'done') {
    return NextResponse.json({ error: t('pageAlreadyProcessed') }, { status: 409 });
  }
  // Zápis výsledku by archivovanou („smazanou") stránku odarchivoval.
  if (page.status === 'archived') {
    return NextResponse.json({ error: t('pageArchived') }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  // Validujeme typy všech polí před zápisem – dřív nevalidní glosář shodil
  // createMany až po vytvoření dokumentu a stránka uvízla (další submit pak
  // končil 500 na unikátním pageId).
  const parsed = parseSubmittedResult(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: `${t('invalidBody')}: ${parsed.field}` }, { status: 400 });
  }
  const { result } = parsed;

  if (result.transcription.trim() === '' || result.translation.trim() === '') {
    return NextResponse.json({ error: t('transcriptionTranslationRequired') }, { status: 400 });
  }
  // Kód jazyka se později vkládá do promptů – jen z povoleného seznamu.
  if (!isTranslationLanguage(result.translationLanguage)) {
    return NextResponse.json({ error: t('unsupportedLanguage') }, { status: 400 });
  }

  const language = result.translationLanguage;
  const versions = [
    { field: 'transcription', content: result.transcription },
    { field: `translation:${language}`, content: result.translation },
    ...(result.context ? [{ field: 'context', content: result.context }] : []),
  ];

  try {
    // Dokument, překlad, glosář, verze i stav stránky v jedné transakci – buď se
    // uloží celý výsledek, nebo nic (a submit jde zopakovat).
    const documentId = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          pageId: id,
          hash: page.hash,
          transcription: result.transcription,
          detectedLanguage: result.detectedLanguage ?? 'unknown',
          context: result.context ?? '',
          model: result.model ?? 'claude-cli',
          processingTimeMs: result.processingTimeMs ?? null,
          translations: {
            create: { language, text: result.translation, context: result.context ?? '' },
          },
          glossary: { create: result.glossary },
        },
        select: { id: true },
      });

      // Dokument vzniká v této transakci, takže jiný zápis verzí nemůže kolidovat –
      // čísla verzí začínají od 1 (createVersion jede mimo transakci a dokument
      // by ještě neviděl).
      await tx.documentVersion.createMany({
        data: versions.map((v, i) => ({
          documentId: document.id,
          version: i + 1,
          field: v.field,
          content: v.content,
          source: 'ai_initial',
          model: result.model ?? null,
        })),
      });

      // Podmíněně: stránka mohla být mezitím archivována.
      await tx.page.updateMany({
        where: { id, status: { not: 'archived' } },
        data: { status: 'done', errorMessage: null },
      });

      return document.id;
    });

    return NextResponse.json({ documentId, status: 'done' });
  } catch (err) {
    // Souběžný submit (nebo worker) mezitím dokument vytvořil – unikátní pageId.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: t('pageAlreadyProcessed') }, { status: 409 });
    }
    throw err;
  }
}
