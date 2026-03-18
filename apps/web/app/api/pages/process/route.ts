import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaude } from '@/lib/adapters/ocr/claude-vision';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request: NextRequest): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return Response.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('pageIds' in body)) {
    return Response.json({ error: 'Chybí pageIds' }, { status: 400 });
  }

  const { pageIds, language } = body as { pageIds: unknown; language?: unknown };

  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return Response.json({ error: 'pageIds musí být neprázdné pole' }, { status: 400 });
  }

  // Verify all pages belong to the current user
  const ownedPages = await prisma.page.findMany({
    where: { id: { in: pageIds as string[] }, userId },
    select: { id: true },
  });
  const ownedIds = new Set(ownedPages.map((p) => p.id));
  const unauthorizedIds = (pageIds as string[]).filter((pid) => !ownedIds.has(pid));
  if (unauthorizedIds.length > 0) {
    return Response.json({ error: 'Některé stránky nepatří přihlášenému uživateli' }, { status: 403 });
  }

  const targetLang =
    typeof language === 'string' && language.trim() !== '' ? language.trim() : 'cs';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const total = pageIds.length as number;
      let completed = 0;

      // Get average output tokens from previous documents for progress estimation
      const avgResult = await prisma.document.aggregate({
        _avg: { outputTokens: true },
        where: { outputTokens: { not: null } },
      });
      const estimatedTokens = Math.round(avgResult._avg.outputTokens ?? 1500);

      for (const pageId of pageIds) {
        if (typeof pageId !== 'string') {
          completed++;
          sendEvent(controller, encoder, 'page_error', {
            pageId,
            error: 'Neplatné ID stránky',
          });
          continue;
        }

        try {
          // Fetch the page record with collection context
          const page = await prisma.page.findUnique({
            where: { id: pageId },
            include: {
              collection: { select: { context: true } },
              document: {
                include: {
                  translations: { select: { language: true } },
                  glossary: true,
                },
              },
            },
          });

          if (!page) {
            completed++;
            sendEvent(controller, encoder, 'page_error', {
              pageId,
              error: 'Stránka nenalezena',
            });
            continue;
          }

          // Skip if document with requested language already exists
          if (page.document !== null) {
            const hasTranslation = page.document.translations.some(
              (t) => t.language === targetLang,
            );
            if (hasTranslation) {
              completed++;
              sendEvent(controller, encoder, 'page_skipped', {
                pageId,
                reason: 'Dokument již existuje s požadovaným jazykem',
                progress: Math.round((completed / total) * 100),
              });
              continue;
            }
          }

          // Mark as processing
          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'processing', errorMessage: null },
          });

          sendEvent(controller, encoder, 'page_progress', {
            pageId,
            message: 'Zpracovávám…',
            progress: Math.round((completed / total) * 100),
          });

          // Load image from disk
          const filename = page.imageUrl.replace('/api/images/', '');
          const imagePath = `tmp/uploads/${filename}`;
          const imageBuffer = await fs.readFile(imagePath);
          const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

          // Check if document with same hash exists (different page, same image)
          const existingByHash = await prisma.document.findUnique({
            where: { hash: imageHash },
            include: {
              translations: true,
              glossary: true,
            },
          });

          if (existingByHash !== null) {
            const existingTranslation = existingByHash.translations.find(
              (t) => t.language === targetLang,
            );

            if (existingTranslation !== undefined) {
              // Reuse existing document – link page to it if not yet linked
              if (page.document === null) {
                // Cannot link because pageId is unique – just update status
              }
              await prisma.page.update({
                where: { id: pageId },
                data: { status: 'done' },
              });

              completed++;
              sendEvent(controller, encoder, 'page_done', {
                pageId,
                documentId: existingByHash.id,
                cached: true,
                progress: Math.round((completed / total) * 100),
              });
              continue;
            }
          }

          // Build prompt with optional collection context
          const collectionContext = page.collection?.context;
          let userPrompt = 'Přepiš text z tohoto rukopisu.';
          if (collectionContext) {
            userPrompt = `Kontext díla (použij pro lepší porozumění dokumentu):\n${collectionContext}\n\n---\n\nPřepiš text z tohoto rukopisu.`;
          }

          // Run Claude OCR with streaming progress
          const { result, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
            await processWithClaude(
              imageBuffer,
              userPrompt,
              (currentTokens, estTotal) => {
                const tokenProgress = Math.min(currentTokens / estTotal, 0.95);
                const pageBase = completed / total;
                const pageSlice = 1 / total;
                const overallProgress = Math.round((pageBase + pageSlice * tokenProgress) * 100);
                sendEvent(controller, encoder, 'page_progress', {
                  pageId,
                  message: `Generuji text… (${currentTokens}/${estTotal} tokenů)`,
                  progress: overallProgress,
                });
              },
              estimatedTokens,
            );
          console.log(
            `[BatchProcess] Page ${pageId} done in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
          );

          let doc;
          if (page.document !== null) {
            // Document exists but needs a new translation
            await prisma.translation.create({
              data: {
                documentId: page.document.id,
                language: result.translationLanguage || targetLang,
                text: result.translation,
              },
            });
            doc = page.document;
          } else {
            // Create new document linked to this page
            doc = await prisma.document.create({
              data: {
                pageId,
                hash: imageHash,
                rawResponse,
                transcription: result.transcription,
                detectedLanguage: result.detectedLanguage,
                context: result.context,
                model,
                inputTokens,
                outputTokens,
                processingTimeMs,
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
            });

            // Save initial versions
            await createVersion(doc.id, 'transcription', result.transcription, 'ai_initial', model);
            await createVersion(doc.id, `translation:${result.translationLanguage || targetLang}`, result.translation, 'ai_initial', model);
            await createVersion(doc.id, 'context', result.context, 'ai_initial', model);
          }

          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'done', errorMessage: null },
          });

          completed++;
          sendEvent(controller, encoder, 'page_done', {
            pageId,
            documentId: doc.id,
            cached: false,
            progress: Math.round((completed / total) * 100),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Neznámá chyba';
          console.error(`[BatchProcess] Page ${pageId} error:`, message);

          try {
            await prisma.page.update({
              where: { id: pageId },
              data: { status: 'error', errorMessage: message },
            });
          } catch {
            // ignore update failure
          }

          completed++;
          sendEvent(controller, encoder, 'page_error', {
            pageId,
            error: message,
            progress: Math.round((completed / total) * 100),
          });
        }
      }

      sendEvent(controller, encoder, 'done', { total, completed });
      controller.close();
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
