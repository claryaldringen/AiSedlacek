import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/infrastructure/db';
import { checkBalance } from '@/lib/infrastructure/billing';
import { isTranslationLanguage } from '@ai-sedlacek/shared';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

const MAX_PREVIOUS_TRANSLATION_CHARS = 100_000;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { balance, sufficient } = await checkBalance(userId);
  if (!sufficient) {
    return NextResponse.json({ error: 'insufficient_tokens', balance }, { status: 402 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { language, previousTranslation } =
    (body as {
      language?: unknown;
      previousTranslation?: unknown;
    }) ?? {};
  if (language !== undefined && !isTranslationLanguage(language)) {
    return NextResponse.json({ error: t('unsupportedLanguage') }, { status: 400 });
  }
  const targetLang = language ?? 'cs';
  // previousTranslation jde do promptu – omezit velikost (náklady na tokeny).
  if (previousTranslation !== undefined && typeof previousTranslation !== 'string') {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }
  if (
    typeof previousTranslation === 'string' &&
    previousTranslation.length > MAX_PREVIOUS_TRANSLATION_CHARS
  ) {
    return NextResponse.json({ error: t('messageTooLong') }, { status: 400 });
  }

  // Verify document exists and belongs to user
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      page: { select: { userId: true } },
    },
  });
  if (!doc || doc.page.userId !== userId) {
    return NextResponse.json({ error: t('documentNotFound') }, { status: 404 });
  }

  // Create ProcessingJob for the worker to pick up
  const job = await prisma.processingJob.create({
    data: {
      userId,
      status: 'queued',
      type: 'retranslate',
      jobData: JSON.stringify({
        documentId: id,
        language: targetLang,
        userId,
        previousTranslation: previousTranslation ?? undefined,
      }),
      totalPages: 1,
      completedPages: 0,
      pageIds: [],
      currentStep:
        targetLang === 'cs'
          ? 'Ve frontě — čeká na retranslaci…'
          : 'Queued — waiting for retranslation…',
    },
  });

  return NextResponse.json({ jobId: job.id });
}
