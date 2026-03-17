import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `Jsi expert na paleografii a historické rukopisy. Pomáháš uživateli s analýzou a korekcí přepisu středověkého dokumentu.

Máš k dispozici:
- Originální obrázek dokumentu
- Aktuální transkripci (přepis)
- Aktuální překlad do moderního jazyka
- Historický kontext
- Glosář

Když uživatel požádá o opravu transkripce nebo překladu, odpověz s opraveným textem ve speciálním formátu:

Pro opravu transkripce:
<update field="transcription">
opravený celý text transkripce
</update>

Pro opravu překladu:
<update field="translation">
opravený celý text překladu
</update>

Pro opravu kontextu:
<update field="context">
opravený text kontextu
</update>

Tyto bloky vlož do své odpovědi na místě, kde je přirozené. Můžeš kombinovat vysvětlení s opravami.
Pokud uživatel žádá jen informaci (ne opravu), odpověz normálně bez update bloků.
Odpovídej v jazyce, kterým píše uživatel.`;

export async function POST(request: NextRequest, { params }: RouteContext): Promise<Response> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { messages } = (body as { messages?: ChatMessage[] }) ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'Chybí messages' }, { status: 400 });
  }

  // Load document with all context
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      translations: true,
      glossary: true,
      page: { select: { imageUrl: true, mimeType: true } },
    },
  });

  if (!doc) {
    return Response.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }

  // Load the image for multimodal context
  const filename = doc.page.imageUrl.replace('/api/images/', '');
  const imagePath = `tmp/uploads/${filename}`;
  let imageBase64: string | null = null;
  let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
  try {
    const imageBuffer = await fs.readFile(imagePath);
    imageBase64 = imageBuffer.toString('base64');
    if (doc.page.mimeType === 'image/png') mediaType = 'image/png';
    else if (doc.page.mimeType === 'image/webp') mediaType = 'image/webp';
  } catch {
    // Image not available — continue without it
  }

  // Build context message
  const translation = doc.translations[0];
  const glossaryText = doc.glossary.length > 0
    ? doc.glossary.map((g) => `${g.term}: ${g.definition}`).join('\n')
    : '(žádný)';

  const contextText = `=== AKTUÁLNÍ TRANSKRIPCE ===
${doc.transcription}

=== AKTUÁLNÍ PŘEKLAD (${translation?.language ?? '?'}) ===
${translation?.text ?? '(žádný)'}

=== KONTEXT ===
${doc.context || '(žádný)'}

=== GLOSÁŘ ===
${glossaryText}`;

  // Build messages for Claude
  type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };

  const firstUserContent: ContentBlock[] = [];
  if (imageBase64) {
    firstUserContent.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    });
  }
  firstUserContent.push({ type: 'text', text: contextText });
  firstUserContent.push({ type: 'text', text: messages[0]!.content });

  const claudeMessages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [
    { role: 'user', content: firstUserContent },
  ];

  // Add remaining conversation history
  for (let i = 1; i < messages.length; i++) {
    claudeMessages.push({ role: messages[i]!.role, content: messages[i]!.content });
  }

  // Stream response
  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: claudeMessages,
        });

        anthropicStream.on('text', (text) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
        });

        await anthropicStream.finalMessage();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
