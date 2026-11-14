import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { InsufficientCreditError, runBilledCall } from '@/lib/infrastructure/billing';
import { insufficientCreditResponse } from '@/lib/infrastructure/credit';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import {
  LLM_MAX_TOKENS,
  TEXT_MODEL,
  estimateInputTokens,
  reservationCredits,
} from '@ai-sedlacek/shared';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Extract structured metadata from the collection's existing context using Claude.
 * Updates title, author, yearFrom, yearTo, librarySignature, abstract.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where: { id },
    select: { id: true, userId: true, context: true, name: true },
  });

  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  if (!collection.context || collection.context.trim().length === 0) {
    return NextResponse.json({ error: t('collectionHasNoContext') }, { status: 400 });
  }

  // Whitelist locale (it gets interpolated into the prompt) to avoid injection.
  const rawLocale =
    request.headers.get('X-Locale') ||
    request.headers.get('Accept-Language')?.split(',')[0]?.split('-')[0] ||
    'cs';
  const locale = rawLocale === 'cs' || rawLocale === 'en' ? rawLocale : 'cs';

  const prompt =
    locale === 'cs'
      ? `Z následujícího kontextu historického díla extrahuj strukturovaná metadata. Vrať POUZE platný JSON objekt bez markdown backticks, bez dalšího textu.

Formát:
{
  "title": "název díla nebo null",
  "author": "autor nebo null",
  "yearFrom": číslo nebo null,
  "yearTo": číslo nebo null,
  "librarySignature": "signatura nebo null",
  "abstract": "stručný popis do 200 znaků nebo null"
}

Kontext:
${collection.context}`
      : `Extract structured metadata from the following historical manuscript context. Return ONLY a valid JSON object without markdown backticks, without any other text. Write all values in ${locale === 'en' ? 'English' : locale}.

Format:
{
  "title": "work title or null",
  "author": "author or null",
  "yearFrom": number or null,
  "yearTo": number or null,
  "librarySignature": "library signature or null",
  "abstract": "brief description up to 200 characters or null"
}

Context:
${collection.context}`;

  // Rezervace maximální ceny před voláním, vyúčtování hned po něm – bez ohledu
  // na to, jak dopadne parsování níže (BIL-1). Bez volného kreditu 402.
  const client = new Anthropic();
  const referenceId = `extract-metadata:${id}:${randomUUID()}`;
  const description = `Metadata svazku ${collection.name}`;
  let response: Anthropic.Message;
  try {
    ({ result: response } = await runBilledCall(
      {
        userId,
        referenceId,
        description,
        amount: reservationCredits(
          [TEXT_MODEL],
          estimateInputTokens(prompt),
          LLM_MAX_TOKENS.contextMetadata,
        ),
      },
      () =>
        client.messages.create({
          model: TEXT_MODEL,
          max_tokens: LLM_MAX_TOKENS.contextMetadata,
          messages: [{ role: 'user', content: prompt }],
        }),
      (r) => [
        {
          referenceId,
          description,
          model: r.model,
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          collectionId: id,
        },
      ],
    ));
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(request, t, err);
    throw err;
  }

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  if (!text) {
    return NextResponse.json({ error: t('aiNoResult') }, { status: 500 });
  }

  let parsed: Record<string, unknown>;
  try {
    // Strip optional ```json code fences before parsing.
    const jsonText = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: t('aiParseError') }, { status: 500 });
  }

  const metadata = {
    title: typeof parsed.title === 'string' ? parsed.title : null,
    author: typeof parsed.author === 'string' ? parsed.author : null,
    yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : null,
    yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : null,
    librarySignature: typeof parsed.librarySignature === 'string' ? parsed.librarySignature : null,
    abstract: typeof parsed.abstract === 'string' ? parsed.abstract : null,
  };

  await prisma.collection.update({
    where: { id },
    data: metadata,
  });

  return NextResponse.json(metadata);
}
