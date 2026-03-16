import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaude } from '@/lib/adapters/ocr/claude-vision';

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('imageUrl' in body)) {
    return Response.json({ error: 'Chybí imageUrl' }, { status: 400 });
  }

  const { imageUrl, language } = body as { imageUrl: string; language?: string };
  const targetLang = language ?? 'cs';

  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    return Response.json({ error: 'imageUrl musí být neprázdný řetězec' }, { status: 400 });
  }

  const filename = imageUrl.replace(/^\/api\/images\//, '');
  const imagePath = `tmp/uploads/${filename}`;

  let imageBuffer: Buffer;
  try {
    imageBuffer = await fs.readFile(imagePath);
  } catch {
    return Response.json({ error: `Soubor nenalezen: ${imagePath}` }, { status: 400 });
  }

  const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Check if document already exists in DB
        const existing = await prisma.document.findUnique({
          where: { hash },
          include: {
            translations: true,
            glossary: true,
          },
        });

        if (existing) {
          // Check if we have translation in the requested language
          const existingTranslation = existing.translations.find((t) => t.language === targetLang);

          if (existingTranslation) {
            console.log(`[Process] DB hit: ${hash.slice(0, 8)}… (lang: ${targetLang})`);
            sendEvent(controller, encoder, 'progress', {
              step: 'cached',
              message: 'Dokument nalezen v knihovně',
              progress: 100,
            });
            sendEvent(controller, encoder, 'result', {
              id: existing.id,
              transcription: existing.transcription,
              detectedLanguage: existing.detectedLanguage,
              translation: existingTranslation.text,
              translationLanguage: targetLang,
              context: existing.context,
              glossary: existing.glossary.map((g) => ({ term: g.term, definition: g.definition })),
              cached: true,
            });
            return;
          }

          // Document exists but no translation in this language – translate
          sendEvent(controller, encoder, 'progress', {
            step: 'translating',
            message: `Překládám do jazyka: ${targetLang}…`,
            progress: 30,
          });

          const client = (await import('@anthropic-ai/sdk')).default;
          const anthropic = new client();
          const translateResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8192,
            messages: [
              {
                role: 'user',
                content: `Přelož tento historický text do moderní ${targetLang === 'cs' ? 'češtiny' : targetLang === 'en' ? 'angličtiny' : targetLang === 'de' ? 'němčiny' : targetLang}. Zachovej všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů.\n\n${existing.transcription}`,
              },
            ],
          });

          const translatedText =
            translateResponse.content[0]?.type === 'text' ? translateResponse.content[0].text : '';

          await prisma.translation.create({
            data: {
              documentId: existing.id,
              language: targetLang,
              text: translatedText,
            },
          });

          sendEvent(controller, encoder, 'progress', {
            step: 'done',
            message: 'Hotovo',
            progress: 100,
          });
          sendEvent(controller, encoder, 'result', {
            id: existing.id,
            transcription: existing.transcription,
            detectedLanguage: existing.detectedLanguage,
            translation: translatedText,
            translationLanguage: targetLang,
            context: existing.context,
            glossary: existing.glossary.map((g) => ({ term: g.term, definition: g.definition })),
            cached: false,
          });
          return;
        }

        // New document – full processing
        sendEvent(controller, encoder, 'progress', {
          step: 'ocr',
          message: 'Zpracovávám text (Claude Opus 4.6)…',
          progress: 20,
        });

        const { result, processingTimeMs } = await processWithClaude(
          imageBuffer,
          'Přepiš text z tohoto rukopisu.',
        );
        console.log(`[Process] Claude done in ${processingTimeMs}ms`);

        // Ensure a Page record exists for this imageUrl (upsert by imageUrl)
        let page = await prisma.page.findFirst({ where: { imageUrl } });
        if (!page) {
          page = await prisma.page.create({
            data: {
              filename,
              hash,
              imageUrl,
              status: 'done',
            },
          });
        } else {
          await prisma.page.update({ where: { id: page.id }, data: { status: 'done' } });
        }

        // Save to DB
        const doc = await prisma.document.create({
          data: {
            hash,
            pageId: page.id,
            transcription: result.transcription,
            detectedLanguage: result.detectedLanguage,
            context: result.context,
            glossary: {
              create: result.glossary.map((g) => ({
                term: g.term,
                definition: g.definition,
              })),
            },
            translations: {
              create: {
                language: result.translationLanguage || targetLang,
                text: result.translation,
              },
            },
          },
          include: {
            glossary: true,
            translations: true,
          },
        });

        sendEvent(controller, encoder, 'progress', {
          step: 'done',
          message: 'Hotovo',
          progress: 100,
        });

        sendEvent(controller, encoder, 'result', {
          id: doc.id,
          transcription: result.transcription,
          detectedLanguage: result.detectedLanguage,
          translation: result.translation,
          translationLanguage: result.translationLanguage || targetLang,
          context: result.context,
          glossary: result.glossary,
          cached: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        console.error('[Process] Error:', message);
        sendEvent(controller, encoder, 'error', { error: message });
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
