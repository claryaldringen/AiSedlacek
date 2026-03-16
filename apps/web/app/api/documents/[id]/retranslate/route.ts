import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { language } = (body as { language?: string }) ?? {};
  const targetLang = typeof language === 'string' ? language : 'cs';

  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }

  const langName: Record<string, string> = {
    cs: 'češtiny',
    en: 'angličtiny',
    de: 'němčiny',
    fr: 'francouzštiny',
    la: 'latiny',
  };

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `Přelož tento historický přepis do moderní ${langName[targetLang] ?? targetLang}. Zachovej strukturu, všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů. Formátuj jako markdown.\n\n${doc.transcription}`,
      },
    ],
  });

  const translatedText =
    response.content[0]?.type === 'text' ? response.content[0].text : '';

  await prisma.translation.upsert({
    where: { documentId_language: { documentId: id, language: targetLang } },
    update: {
      text: translatedText,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    create: {
      documentId: id,
      language: targetLang,
      text: translatedText,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  });

  return NextResponse.json({ translation: translatedText, language: targetLang });
}
