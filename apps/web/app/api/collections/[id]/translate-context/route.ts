import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

const LANGUAGE_NAMES: Record<string, string> = {
  cs: 'Czech',
  en: 'English',
};

/**
 * Translate collection context from one language to another using Claude.
 * POST body: { targetLanguage: string }
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { targetLanguage } = (body as { targetLanguage?: string }) ?? {};
  if (typeof targetLanguage !== 'string' || !targetLanguage.trim()) {
    return NextResponse.json({ error: 'Missing targetLanguage' }, { status: 400 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  if (!collection.context || collection.context.trim().length === 0) {
    return NextResponse.json({ error: 'No context to translate' }, { status: 400 });
  }

  const sourceLang =
    LANGUAGE_NAMES[collection.contextLanguage ?? 'cs'] ?? collection.contextLanguage ?? 'Czech';
  const targetLang = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

  const client = new Anthropic();
  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Translate the following historical manuscript context from ${sourceLang} to ${targetLang}. Keep the markdown formatting intact. Translate naturally — this is scholarly/academic text about a historical manuscript.

${collection.context}`,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI error';
    return NextResponse.json({ error: `Translation failed: ${message}` }, { status: 422 });
  }

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

  await prisma.collection.update({
    where: { id },
    data: { context, contextLanguage: targetLanguage },
  });

  return NextResponse.json({
    context,
    contextLanguage: targetLanguage,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}
