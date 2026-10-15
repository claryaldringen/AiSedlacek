import { NextRequest } from 'next/server';

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage, storageKeyFromImageUrl } from '@/lib/adapters/storage';
import { prepareImage, type ImageMediaType } from '@ai-sedlacek/ocr';
import { checkBalance, deductTokensIfSufficient } from '@/lib/infrastructure/billing';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { withSharpLimit } from '@/lib/infrastructure/sharp-limit';
import { TEXT_MODEL } from '@ai-sedlacek/shared';

type RouteContext = { params: Promise<{ id: string }> };

/** Odhad výstupních tokenů z textu přerušené odpovědi (stejně jako worker). */
const CHARS_PER_TOKEN = 4;

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
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { balance, sufficient } = await checkBalance(userId);
  if (!sufficient) {
    const encoder = new TextEncoder();
    const body = encoder.encode(
      `data: ${JSON.stringify({ type: 'insufficient_tokens', balance })}\n\n`,
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { messages } = (body as { messages?: ChatMessage[] }) ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: t('missingMessages') }, { status: 400 });
  }

  // Bound the request so a single chat call can't burn an unbounded amount of
  // tokens (and money): cap the number of turns and the total input size.
  const MAX_MESSAGES = 50;
  const MAX_TOTAL_CHARS = 100_000;
  if (messages.length > MAX_MESSAGES) {
    return Response.json({ error: t('tooManyMessages') }, { status: 400 });
  }
  // Jen textové zprávy s povolenou rolí – pole content bloků dřív obešlo limit
  // znaků (počítal jen stringy) a role šla do API nevalidovaná.
  const valid = messages.every(
    (m: unknown) =>
      typeof m === 'object' &&
      m !== null &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
      typeof (m as ChatMessage).content === 'string' &&
      (m as ChatMessage).content.trim() !== '',
  );
  if (!valid || messages[0]!.role !== 'user') {
    return Response.json({ error: t('invalidMessages') }, { status: 400 });
  }
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json({ error: t('messageTooLong') }, { status: 400 });
  }

  // Load document with all context
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      translations: true,
      glossary: true,
      page: { select: { imageUrl: true, mimeType: true, userId: true } },
    },
  });

  if (!doc || doc.page.userId !== userId) {
    return Response.json({ error: t('documentNotFound') }, { status: 404 });
  }

  // Load the image for multimodal context (resize if > 5 MB)
  const storage = getStorage();
  const storagePath = storageKeyFromImageUrl(doc.page.imageUrl);
  let imageBase64: string | null = null;
  let mediaType: ImageMediaType = 'image/jpeg';
  try {
    // Stejná příprava jako u OCR: limit velikosti pro API, převod TIFF a dalších
    // nepodporovaných formátů, EXIF orientace a limit pixelů (SEC-13). Dřív se
    // TIFF poslal jako image/jpeg a API odmítlo celý chat.
    // Dekódování skenu sdílí semafor s uploady – jinak by souběžné chaty a uploady
    // mohly přesáhnout paměťový limit procesu.
    const original = await storage.read(storagePath);
    const prepared = await withSharpLimit(() => prepareImage(original));
    imageBase64 = prepared.buffer.toString('base64');
    mediaType = prepared.mediaType;
  } catch {
    // Image not available — continue without it
  }

  // Build context message
  const translation = doc.translations[0];
  const glossaryText =
    doc.glossary.length > 0
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
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };

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

  // Klient může spojení kdykoli zavřít – pak enqueue/close vyhodí výjimku. Příznak
  // `closed` chrání zápisy do streamu a cancel() zastaví generování, aby model
  // nepsal (a my neplatili) text, který už nikdo nečte.
  let closed = false;
  let anthropicStream: { abort(): void; currentMessage: Anthropic.Message | undefined } | null =
    null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream už je zavřený (klient odešel) – další zápisy přeskočíme.
          closed = true;
          anthropicStream?.abort();
        }
      };

      // Spotřeba se účtuje nejvýš jednou – ani selhání účtování v hlavní cestě
      // nesmí vést k druhému (částečnému) stržení v chybové cestě.
      let charged = false;
      const charge = async (
        inputTokens: number,
        outputTokens: number,
        model: string,
        description: string,
      ): Promise<void> => {
        if (charged) return;
        charged = true;
        const deductResult = await deductTokensIfSufficient(
          userId,
          inputTokens,
          outputTokens,
          description,
          `chat-${id}-${Date.now()}`,
          model,
        );
        if (!deductResult.success) {
          console.warn(`[Chat] Insufficient balance for user ${userId}, response already streamed`);
        }
      };

      let streamedChars = 0;
      try {
        const messageStream = client.messages.stream({
          model: TEXT_MODEL,
          max_tokens: 8192,
          temperature: 0.7,
          system: SYSTEM_PROMPT,
          messages: claudeMessages,
        });
        anthropicStream = messageStream;

        messageStream.on('text', (text) => {
          streamedChars += text.length;
          send({ type: 'text', text });
        });

        const finalMsg = await messageStream.finalMessage();
        const usage = {
          inputTokens: finalMsg.usage.input_tokens,
          outputTokens: finalMsg.usage.output_tokens,
          model: finalMsg.model,
        };

        // Atomically check balance and deduct tokens
        await charge(
          finalMsg.usage.input_tokens,
          finalMsg.usage.output_tokens,
          finalMsg.model,
          `Chat s dokumentem ${id}`,
        );

        send({ type: 'done', usage });
      } catch (err) {
        // Přerušená odpověď (klient zavřel spojení, chyba API uprostřed streamu) už
        // stála peníze – naúčtujeme spotřebu, která vznikla. Vstup a model známe
        // z message_start (snapshot `currentMessage`), výstup z posledního
        // message_delta; dokud nepřišel, odhadneme ho z odeslaného textu (4 znaky
        // na token – spíš podhodnocuje, uživatel nezaplatí víc, než spotřeboval).
        // Bez snapshotu (chyba před message_start) žádná spotřeba nevznikla.
        const partial = anthropicStream?.currentMessage;
        if (partial && !charged) {
          const outputTokens = Math.max(
            partial.usage.output_tokens,
            Math.ceil(streamedChars / CHARS_PER_TOKEN),
          );
          console.warn(
            `[Chat] Odpověď přerušena (${closed ? 'klient zavřel spojení' : 'chyba'}) – ` +
              `účtuji částečnou spotřebu: model=${partial.model} ` +
              `in=${partial.usage.input_tokens} out=${outputTokens}`,
          );
          try {
            await charge(
              partial.usage.input_tokens,
              outputTokens,
              partial.model,
              `Chat s dokumentem ${id} (přerušeno)`,
            );
          } catch (billingErr) {
            console.error('[Chat] Částečnou spotřebu se nepodařilo naúčtovat:', billingErr);
          }
        }

        const message = err instanceof Error ? err.message : t('serverError');
        send({ type: 'error', error: message });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Stream už mezitím zavřel klient.
          }
        }
      }
    },
    cancel() {
      closed = true;
      anthropicStream?.abort();
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
