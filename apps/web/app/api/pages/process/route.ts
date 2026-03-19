import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaude, processWithClaudeBatch } from '@/lib/adapters/ocr/claude-vision';
import type { StructuredOcrResult, ProcessingMode } from '@/lib/adapters/ocr/claude-vision';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';
import { createBatches, truncateContext } from '@/lib/batch-utils';

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/** Fetch transcriptions from previously processed pages in the same collection. */
async function getPreviousPageContext(
  collectionId: string | null,
  currentPageId: string,
  limit: number = 3,
): Promise<string | undefined> {
  if (!collectionId) return undefined;
  const previousPages = await prisma.page.findMany({
    where: {
      collectionId,
      document: { isNot: null },
      id: { not: currentPageId },
    },
    orderBy: { order: 'desc' },
    take: limit,
    include: { document: { select: { transcription: true } } },
  });
  if (previousPages.length === 0) return undefined;
  const text = previousPages
    .reverse()
    .map(
      (p: { document?: { transcription: string } | null }, i: number) =>
        `[Stránka ${i + 1}]\n${p.document?.transcription ?? ''}`,
    )
    .join('\n\n---\n\n');
  return truncateContext(text, 500);
}

/** Save OCR result as a Document (or add translation to existing document). */
async function saveDocumentResult(
  pageId: string,
  existingDoc: { id: string } | null,
  hash: string,
  result: StructuredOcrResult,
  rawResponseLine: string,
  metadata: { model: string; inputTokens: number; outputTokens: number; processingTimeMs: number },
  targetLang: string,
  batchId?: string,
): Promise<{ id: string }> {
  if (existingDoc !== null) {
    // Document exists but needs a new translation
    await prisma.translation.create({
      data: {
        documentId: existingDoc.id,
        language: result.translationLanguage || targetLang,
        text: result.translation,
      },
    });
    return existingDoc;
  }

  // Create new document linked to this page
  const doc = await prisma.document.create({
    data: {
      pageId,
      hash,
      rawResponse: rawResponseLine,
      transcription: result.transcription,
      detectedLanguage: result.detectedLanguage,
      context: result.context,
      model: metadata.model,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      processingTimeMs: metadata.processingTimeMs,
      ...(batchId ? { batchId } : {}),
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

  await createVersion(doc.id, 'transcription', result.transcription, 'ai_initial', metadata.model);
  await createVersion(
    doc.id,
    `translation:${result.translationLanguage || targetLang}`,
    result.translation,
    'ai_initial',
    metadata.model,
  );
  await createVersion(doc.id, 'context', result.context, 'ai_initial', metadata.model);

  return doc;
}

interface PreparedPage {
  pageId: string;
  page: {
    id: string;
    imageUrl: string;
    fileSize?: number | null;
    document: { id: string } | null;
    collection?: { id: string; context: string | null } | null;
  };
  imageBuffer: Buffer;
  imageHash: string;
  collectionContext?: string | null;
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

  const { pageIds, language, mode: rawMode } = body as { pageIds: unknown; language?: unknown; mode?: unknown };

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
    return Response.json(
      { error: 'Některé stránky nepatří přihlášenému uživateli' },
      { status: 403 },
    );
  }

  const targetLang =
    typeof language === 'string' && language.trim() !== '' ? language.trim() : 'cs';

  const processingMode: ProcessingMode =
    rawMode === 'translate' ? 'translate' : 'transcribe+translate';

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

      // ── Phase 1: Pre-filter pages ──────────────────────────
      const pagesToProcess: PreparedPage[] = [];

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
          const page = await prisma.page.findUnique({
            where: { id: pageId },
            include: {
              collection: { select: { id: true, context: true } },
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
              (t: { language: string }) => t.language === targetLang,
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
              (t: { language: string }) => t.language === targetLang,
            );

            if (existingTranslation !== undefined) {
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

          // Page needs processing — add to batch
          pagesToProcess.push({
            pageId,
            page,
            imageBuffer,
            imageHash,
            collectionContext: page.collection?.context,
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

      // ── Phase 2: Create batches ────────────────────────────
      if (pagesToProcess.length === 0) {
        sendEvent(controller, encoder, 'done', { total, completed });
        controller.close();
        return;
      }

      const batches = createBatches(
        pagesToProcess.map((p) => ({ id: p.pageId, fileSize: p.imageBuffer.length })),
        { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: estimatedTokens },
      );

      // ── Phase 3: Process each batch ────────────────────────
      let batchNumber = 0;
      for (const batch of batches) {
        batchNumber++;
        const batchPageIds = new Set(batch.map((b) => b.id));
        const batchPages = pagesToProcess.filter((p) => batchPageIds.has(p.pageId));

        sendEvent(controller, encoder, 'batch_info', {
          batchNumber,
          totalBatches: batches.length,
          pageCount: batchPages.length,
        });

        if (batchPages.length === 1) {
          // Single-page batch: use processWithClaude with previousContext
          const pp = batchPages[0]!;
          try {
            const previousContext = await getPreviousPageContext(
              pp.page.collection?.id ?? null,
              pp.pageId,
            );

            let userPrompt = 'Přepiš text z tohoto rukopisu.';
            if (pp.collectionContext) {
              userPrompt = `Kontext díla (použij pro lepší porozumění dokumentu):\n${pp.collectionContext}\n\n---\n\nPřepiš text z tohoto rukopisu.`;
            }

            const { result, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
              await processWithClaude(
                pp.imageBuffer,
                userPrompt,
                (currentTokens: number, estTotal: number) => {
                  const tokenProgress = Math.min(currentTokens / estTotal, 0.95);
                  const pageBase = completed / total;
                  const pageSlice = 1 / total;
                  const overallProgress = Math.round((pageBase + pageSlice * tokenProgress) * 100);
                  sendEvent(controller, encoder, 'page_progress', {
                    pageId: pp.pageId,
                    message: `Generuji text… (${currentTokens}/${estTotal} tokenů)`,
                    progress: overallProgress,
                  });
                },
                estimatedTokens,
                previousContext,
                processingMode,
              );
            console.log(
              `[BatchProcess] Page ${pp.pageId} done in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
            );

            const doc = await saveDocumentResult(
              pp.pageId,
              pp.page.document,
              pp.imageHash,
              result,
              rawResponse,
              { model, inputTokens, outputTokens, processingTimeMs },
              targetLang,
            );

            await prisma.page.update({
              where: { id: pp.pageId },
              data: { status: 'done', errorMessage: null },
            });

            completed++;
            sendEvent(controller, encoder, 'page_done', {
              pageId: pp.pageId,
              documentId: doc.id,
              cached: false,
              progress: Math.round((completed / total) * 100),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Neznámá chyba';
            console.error(`[BatchProcess] Page ${pp.pageId} error:`, message);

            try {
              await prisma.page.update({
                where: { id: pp.pageId },
                data: { status: 'error', errorMessage: message },
              });
            } catch {
              // ignore update failure
            }

            completed++;
            sendEvent(controller, encoder, 'page_error', {
              pageId: pp.pageId,
              error: message,
              progress: Math.round((completed / total) * 100),
            });
          }
        } else {
          // Multi-page batch: use processWithClaudeBatch with fallback
          const batchId = `batch-${Date.now()}-${batchNumber}`;
          let batchSuccess = false;

          try {
            // Get previous context from pages processed before this batch
            const firstPage = batchPages[0]!;
            const previousContext = await getPreviousPageContext(
              firstPage.page.collection?.id ?? null,
              firstPage.pageId,
            );

            const images = batchPages.map((pp, idx) => ({
              buffer: pp.imageBuffer,
              pageId: pp.pageId,
              index: idx,
            }));

            const userPrompt = 'Přepiš text z tohoto rukopisu.';
            const collectionCtx = firstPage.collectionContext ?? undefined;

            const batchResult = await processWithClaudeBatch(images, userPrompt, {
              collectionContext: collectionCtx,
              previousContext,
              estimatedOutputTokens: estimatedTokens * batchPages.length,
              mode: processingMode,
              onProgress: (currentTokens: number, estTotal: number) => {
                const tokenProgress = Math.min(currentTokens / estTotal, 0.95);
                const batchBase = completed / total;
                const batchSlice = batchPages.length / total;
                const overallProgress = Math.round((batchBase + batchSlice * tokenProgress) * 100);
                sendEvent(controller, encoder, 'batch_progress', {
                  batchNumber,
                  message: `Generuji text… (${currentTokens}/${estTotal} tokenů)`,
                  progress: overallProgress,
                });
              },
            });

            console.log(
              `[BatchProcess] Batch ${batchNumber} done in ${batchResult.processingTimeMs}ms (${batchResult.model}, ${batchResult.inputTokens}+${batchResult.outputTokens} tokens, ${batchPages.length} pages)`,
            );

            // Match results to pages by index
            const perPageTokens = Math.round(batchResult.outputTokens / batchPages.length);
            const rawLines = batchResult.rawResponse.split('\n');

            for (let i = 0; i < batchPages.length; i++) {
              const pp = batchPages[i]!;
              const resultEntry = batchResult.results.find((r) => r.index === i);

              if (!resultEntry) {
                console.error(`[BatchProcess] No result for page ${pp.pageId} at index ${i}`);
                try {
                  await prisma.page.update({
                    where: { id: pp.pageId },
                    data: { status: 'error', errorMessage: 'Chybí výsledek z dávky' },
                  });
                } catch {
                  // ignore
                }
                completed++;
                sendEvent(controller, encoder, 'page_error', {
                  pageId: pp.pageId,
                  error: 'Chybí výsledek z dávky',
                  progress: Math.round((completed / total) * 100),
                });
                continue;
              }

              try {
                const rawLine = rawLines[i] ?? batchResult.rawResponse;
                const doc = await saveDocumentResult(
                  pp.pageId,
                  pp.page.document,
                  pp.imageHash,
                  resultEntry.result,
                  rawLine,
                  {
                    model: batchResult.model,
                    inputTokens: Math.round(batchResult.inputTokens / batchPages.length),
                    outputTokens: perPageTokens,
                    processingTimeMs: Math.round(batchResult.processingTimeMs / batchPages.length),
                  },
                  targetLang,
                  batchId,
                );

                await prisma.page.update({
                  where: { id: pp.pageId },
                  data: { status: 'done', errorMessage: null },
                });

                completed++;
                sendEvent(controller, encoder, 'page_done', {
                  pageId: pp.pageId,
                  documentId: doc.id,
                  cached: false,
                  progress: Math.round((completed / total) * 100),
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Neznámá chyba';
                console.error(`[BatchProcess] Page ${pp.pageId} save error:`, message);
                try {
                  await prisma.page.update({
                    where: { id: pp.pageId },
                    data: { status: 'error', errorMessage: message },
                  });
                } catch {
                  // ignore
                }
                completed++;
                sendEvent(controller, encoder, 'page_error', {
                  pageId: pp.pageId,
                  error: message,
                  progress: Math.round((completed / total) * 100),
                });
              }
            }

            batchSuccess = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Neznámá chyba';
            console.warn(
              `[BatchProcess] Batch ${batchNumber} failed: ${message}, falling back to individual processing`,
            );
            batchSuccess = false;
          }

          // Fallback: process each page individually if batch failed
          if (!batchSuccess) {
            for (const pp of batchPages) {
              try {
                let userPrompt = 'Přepiš text z tohoto rukopisu.';
                if (pp.collectionContext) {
                  userPrompt = `Kontext díla (použij pro lepší porozumění dokumentu):\n${pp.collectionContext}\n\n---\n\nPřepiš text z tohoto rukopisu.`;
                }

                const { result, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
                  await processWithClaude(
                    pp.imageBuffer,
                    userPrompt,
                    (currentTokens: number, estTotal: number) => {
                      const tokenProgress = Math.min(currentTokens / estTotal, 0.95);
                      const pageBase = completed / total;
                      const pageSlice = 1 / total;
                      const overallProgress = Math.round(
                        (pageBase + pageSlice * tokenProgress) * 100,
                      );
                      sendEvent(controller, encoder, 'page_progress', {
                        pageId: pp.pageId,
                        message: `Generuji text… (${currentTokens}/${estTotal} tokenů)`,
                        progress: overallProgress,
                      });
                    },
                    estimatedTokens,
                    undefined,
                    processingMode,
                  );
                console.log(
                  `[BatchProcess] Page ${pp.pageId} done in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens) [fallback]`,
                );

                const doc = await saveDocumentResult(
                  pp.pageId,
                  pp.page.document,
                  pp.imageHash,
                  result,
                  rawResponse,
                  { model, inputTokens, outputTokens, processingTimeMs },
                  targetLang,
                );

                await prisma.page.update({
                  where: { id: pp.pageId },
                  data: { status: 'done', errorMessage: null },
                });

                completed++;
                sendEvent(controller, encoder, 'page_done', {
                  pageId: pp.pageId,
                  documentId: doc.id,
                  cached: false,
                  progress: Math.round((completed / total) * 100),
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Neznámá chyba';
                console.error(`[BatchProcess] Page ${pp.pageId} error [fallback]:`, message);

                try {
                  await prisma.page.update({
                    where: { id: pp.pageId },
                    data: { status: 'error', errorMessage: message },
                  });
                } catch {
                  // ignore update failure
                }

                completed++;
                sendEvent(controller, encoder, 'page_error', {
                  pageId: pp.pageId,
                  error: message,
                  progress: Math.round((completed / total) * 100),
                });
              }
            }
          }
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
