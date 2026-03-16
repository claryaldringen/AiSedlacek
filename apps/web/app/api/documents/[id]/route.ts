import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { translations: true, glossary: true },
  });

  if (!doc) {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }

  return NextResponse.json(doc);
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { transcription, translation, translationLanguage, context } = body as {
    transcription?: string;
    translation?: string;
    translationLanguage?: string;
    context?: string;
  };

  const data: Record<string, string> = {};
  if (typeof transcription === 'string') data.transcription = transcription;
  if (typeof context === 'string') data.context = context;

  if (Object.keys(data).length > 0) {
    await prisma.document.update({ where: { id }, data });
  }

  // Update translation if provided
  if (typeof translation === 'string' && typeof translationLanguage === 'string') {
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
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  try {
    await prisma.document.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }
}
