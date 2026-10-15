import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { isTranslationLanguage } from '@ai-sedlacek/shared';
import { canReadPage } from '@/lib/infrastructure/authz';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    // rawResponse u dávkového OCR obsahuje výstup celé dávky (i dalších stránek).
    omit: { rawResponse: true },
    include: {
      translations: true,
      glossary: true,
      page: {
        select: { id: true, userId: true, isPublic: true, status: true, collectionId: true },
      },
    },
  });

  // Číst smí i členové sdíleného workspace; PATCH/DELETE níže dál jen vlastník.
  if (!doc || !(await canReadPage(userId, doc.page))) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  return NextResponse.json({ ...doc, canEdit: doc.page.userId === userId });
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const { transcription, translation, translationLanguage, context } = body as {
    transcription?: string;
    translation?: string;
    translationLanguage?: string;
    context?: string;
  };

  // Validujeme před jakýmkoli zápisem, aby 400 znamenalo „nic se neuložilo". Pole jiného
  // typu než string by se jinak tiše ignorovala a klient by dostal 200.
  const fields = { transcription, translation, translationLanguage, context };
  const invalidField = Object.entries(fields).find(
    ([, value]) => value !== undefined && typeof value !== 'string',
  );
  if (invalidField) {
    return NextResponse.json(
      { error: `${t('invalidBody')}: ${invalidField[0]} must be a string` },
      { status: 400 },
    );
  }

  // Překlad se ukládá per jazyk – bez jazyka ho nelze uložit. Dříve se v tom případě
  // tiše ignoroval a klient (CLI push) dostal 200, takže změnu považoval za uloženou.
  // Prázdný jazyk je chyba klienta; chybějící řeší zpětná kompatibilita níže.
  if (
    translation !== undefined &&
    typeof translationLanguage === 'string' &&
    translationLanguage.trim() === ''
  ) {
    return NextResponse.json({ error: t('translationLanguageRequired') }, { status: 400 });
  }

  // Fetch current state for versioning and ownership check
  // rawResponse (celý batch JSONL, desítky KB) tu není potřeba.
  const current = await prisma.document.findUnique({
    where: { id },
    omit: { rawResponse: true },
    include: { translations: true, page: { select: { userId: true } } },
  });
  if (!current || current.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  // Zpětná kompatibilita: `ais push` < 0.2.0 jazyk překladu neposílá – stahoval
  // vždy první překlad dokumentu. Jednoznačné je to jen u dokumentu s jediným
  // překladem (stejně jako resolvePushLanguage v CLI); jinak 400 a nic se neuloží,
  // ani transkripce z téhož požadavku.
  let language = translationLanguage;
  if (translation !== undefined && language === undefined) {
    if (current.translations.length !== 1) {
      return NextResponse.json({ error: t('translationLanguageRequired') }, { status: 400 });
    }
    language = current.translations[0]!.language;
  }

  // Nový překlad jen v povoleném jazyce – kód se později vkládá do promptů.
  // Úpravy už existujících překladů (i v dříve uložených kódech) zůstávají možné.
  if (
    typeof translation === 'string' &&
    typeof language === 'string' &&
    !isTranslationLanguage(language) &&
    !current.translations.some((tr) => tr.language === language)
  ) {
    return NextResponse.json({ error: t('unsupportedLanguage') }, { status: 400 });
  }

  const data: Record<string, string | Date> = {};

  if (typeof transcription === 'string' && transcription !== current.transcription) {
    await createVersion(id, 'transcription', current.transcription, 'manual_edit');
    data.transcription = transcription;
  }
  if (typeof context === 'string' && context !== current.context) {
    await createVersion(id, 'context', current.context, 'manual_edit');
    data.context = context;
  }

  // Změna překladu musí posunout Document.updatedAt – podle něj `ais push`
  // detekuje konflikt (Translation vlastní updatedAt nemá).
  const existingTranslation =
    typeof language === 'string'
      ? current.translations.find((tr) => tr.language === language)
      : undefined;
  if (
    typeof translation === 'string' &&
    typeof language === 'string' &&
    existingTranslation?.text !== translation
  ) {
    data.updatedAt = new Date();
  }

  if (Object.keys(data).length > 0) {
    await prisma.document.update({ where: { id }, data, select: { id: true } });
  }

  // Update translation if provided
  if (typeof translation === 'string' && typeof language === 'string') {
    if (existingTranslation && existingTranslation.text !== translation) {
      await createVersion(id, `translation:${language}`, existingTranslation.text, 'manual_edit');
    }
    await prisma.translation.upsert({
      where: { documentId_language: { documentId: id, language } },
      update: { text: translation },
      create: { documentId: id, language, text: translation },
    });
  }

  const updated = await prisma.document.findUnique({
    where: { id },
    // Stejně jako GET – rawResponse u dávek obsahuje výstup i dalších stránek.
    omit: { rawResponse: true },
    include: { translations: true, glossary: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

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
