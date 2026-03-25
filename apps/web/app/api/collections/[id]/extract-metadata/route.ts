import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Extract structured metadata from the collection's existing context using Claude.
 * Updates title, author, yearFrom, yearTo, librarySignature, abstract.
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

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Z následujícího kontextu historického díla extrahuj strukturovaná metadata. Vrať POUZE platný JSON objekt bez markdown backticks, bez dalšího textu.

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
${collection.context}`,
      },
    ],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  if (!text) {
    return NextResponse.json({ error: t('aiNoResult') }, { status: 500 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
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
