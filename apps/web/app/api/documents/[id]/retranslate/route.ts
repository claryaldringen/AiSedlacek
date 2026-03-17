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

  const { language, previousTranslation } = (body as {
    language?: string;
    previousTranslation?: string;
  }) ?? {};
  const targetLang = typeof language === 'string' ? language : 'cs';

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { translations: { where: { language: targetLang } } },
  });
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

  const existingTranslation = previousTranslation ?? doc.translations[0]?.text;

  const client = new Anthropic();

  let prompt: string;
  if (existingTranslation) {
    // Incremental update – only fix what changed
    prompt = `Transkripce historického textu byla upravena. Aktualizuj existující překlad tak, aby odpovídal změnám v transkripci. Měň JEN ta místa, která se změnila – zbytek překladu ponech beze změny.

UPRAVENÁ TRANSKRIPCE:
${doc.transcription}

STÁVAJÍCÍ PŘEKLAD (uprav jen změněná místa):
${existingTranslation}

Vrať POUZE aktualizovaný překlad v markdown, nic dalšího.`;
  } else {
    // Full translation from scratch
    prompt = `Přelož tento historický přepis do moderní ${langName[targetLang] ?? targetLang}. Zachovej strukturu, všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů. Formátuj jako markdown.\n\n${doc.transcription}`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
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
