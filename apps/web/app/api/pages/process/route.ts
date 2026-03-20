import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaude, processWithClaudeBatch } from '@/lib/adapters/ocr/claude-vision';
import type { StructuredOcrResult, ProcessingMode } from '@/lib/adapters/ocr/claude-vision';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';
import { createBatches, truncateContext } from '@/lib/batch-utils';
import {
  createJob,
  getActiveJob,
  emitEvent,
  completeJob,
  type ProcessingEvent,
} from '@/lib/infrastructure/processing-jobs';

// ── Helpers ─────────────────────────────────────────────────

function emit(userId: string, event: string, data: unknown): void {
  emitEvent(userId, event, data);
}

async function waitIfPaused(userId: string, signal: AbortSignal, progress: number): Promise<void> {
  const job = getActiveJob(userId);
  if (!job || !job.paused) return;
  emit(userId, 'paused', { message: 'Zpracování pozastaveno', progress });
  await Promise.race([
    job.pausePromise ?? Promise.resolve(),
    new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  ]);
  if (!signal.aborted) {
    emit(userId, 'resumed', { message: 'Zpracování obnoveno', progress });
  }
}

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
    await prisma.translation.create({
      data: {
        documentId: existingDoc.id,
        language: result.translationLanguage || targetLang,
        text: result.translation,
      },
    });
    return existingDoc;
  }

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

// ── Background processing ───────────────────────────────────

async function runProcessing(
  userId: string,
  pageIds: string[],
  targetLang: string,
  processingMode: ProcessingMode,
  signal: AbortSignal,
): Promise<void> {
  const total = pageIds.length;
  let completed = 0;

  try {
    const avgResult = await prisma.document.aggregate({
      _avg: { outputTokens: true },
      where: { outputTokens: { not: null } },
    });
    const estimatedTokens = Math.round(avgResult._avg.outputTokens ?? 1500);

    // ── Phase 1: Pre-filter pages ──────────────────────────
    const pagesToProcess: PreparedPage[] = [];

    for (const pageId of pageIds) {
      if (signal.aborted) {
        emit(userId, 'cancelled', { message: 'Zpracování zrušeno uživatelem' });
        return;
      }

      if (typeof pageId !== 'string') {
        completed++;
        emit(userId, 'page_error', { pageId, error: 'Neplatné ID stránky' });
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
          emit(userId, 'page_error', { pageId, error: 'Stránka nenalezena' });
          continue;
        }

        if (page.status === 'blank') {
          completed++;
          emit(userId, 'page_skipped', {
            pageId,
            reason: 'Prázdná stránka',
            progress: Math.round((completed / total) * 100),
          });
          continue;
        }

        if (page.document !== null) {
          const hasTranslation = page.document.translations.some(
            (t: { language: string }) => t.language === targetLang,
          );
          if (hasTranslation) {
            completed++;
            emit(userId, 'page_skipped', {
              pageId,
              reason: 'Dokument již existuje s požadovaným jazykem',
              progress: Math.round((completed / total) * 100),
            });
            continue;
          }
        }

        await prisma.page.update({
          where: { id: pageId },
          data: { status: 'processing', errorMessage: null },
        });

        emit(userId, 'page_progress', {
          pageId,
          message: 'Zpracovávám…',
          progress: Math.round((completed / total) * 100),
        });

        const filename = page.imageUrl.replace('/api/images/', '');
        const imagePath = `tmp/uploads/${filename}`;
        const imageBuffer = await fs.readFile(imagePath);
        const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        const existingByHash = await prisma.document.findUnique({
          where: { hash: imageHash },
          include: { translations: true, glossary: true },
        });

        if (existingByHash !== null) {
          const existingTranslation = existingByHash.translations.find(
            (t: { language: string }) => t.language === targetLang,
          );

          if (existingTranslation !== undefined) {
            await prisma.page.update({
              where: { id: pageId },
              data: { status: 'done' },
            });

            completed++;
            emit(userId, 'page_done', {
              pageId,
              documentId: existingByHash.id,
              cached: true,
              progress: Math.round((completed / total) * 100),
            });
            continue;
          }
        }

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
          // ignore
        }

        completed++;
        emit(userId, 'page_error', {
          pageId,
          error: message,
          progress: Math.round((completed / total) * 100),
        });
      }
    }

    // ── Phase 2: Create batches ────────────────────────────
    if (pagesToProcess.length === 0) {
      emit(userId, 'done', { total, completed });
      return;
    }

    const batches = createBatches(
      pagesToProcess.map((p) => ({ id: p.pageId, fileSize: p.imageBuffer.length })),
      { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: estimatedTokens },
    );

    // ── Phase 3: Process each batch ────────────────────────
    let batchNumber = 0;
    for (const batch of batches) {
      if (signal.aborted) {
        // Mark remaining pages back to pending
        for (const pp of pagesToProcess.filter(
          (p) => !batch.some((b) => b.id === p.pageId) || true,
        )) {
          try {
            const currentPage = await prisma.page.findUnique({
              where: { id: pp.pageId },
              select: { status: true },
            });
            if (currentPage?.status === 'processing') {
              await prisma.page.update({
                where: { id: pp.pageId },
                data: { status: 'pending' },
              });
            }
          } catch {
            // ignore
          }
        }
        emit(userId, 'cancelled', { message: 'Zpracování zrušeno uživatelem' });
        return;
      }

      batchNumber++;
      const batchPageIds = new Set(batch.map((b) => b.id));
      const batchPages = pagesToProcess.filter((p) => batchPageIds.has(p.pageId));

      emit(userId, 'batch_info', {
        batchNumber,
        totalBatches: batches.length,
        pageCount: batchPages.length,
      });

      if (batchPages.length === 1) {
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
                emit(userId, 'page_progress', {
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
          emit(userId, 'page_done', {
            pageId: pp.pageId,
            documentId: doc.id,
            cached: false,
            progress: Math.round((completed / total) * 100),
          });
          await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Neznámá chyba';
          console.error(`[BatchProcess] Page ${pp.pageId} error:`, message);

          try {
            await prisma.page.update({
              where: { id: pp.pageId },
              data: { status: 'error', errorMessage: message },
            });
          } catch {
            // ignore
          }

          completed++;
          emit(userId, 'page_error', {
            pageId: pp.pageId,
            error: message,
            progress: Math.round((completed / total) * 100),
          });
        }
      } else {
        // Multi-page batch
        const batchId = `batch-${Date.now()}-${batchNumber}`;
        let batchSuccess = false;

        try {
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
              emit(userId, 'batch_progress', {
                batchNumber,
                message: `Generuji text… (${currentTokens}/${estTotal} tokenů)`,
                progress: overallProgress,
              });
            },
          });

          console.log(
            `[BatchProcess] Batch ${batchNumber} done in ${batchResult.processingTimeMs}ms (${batchResult.model}, ${batchResult.inputTokens}+${batchResult.outputTokens} tokens, ${batchPages.length} pages)`,
          );

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
              emit(userId, 'page_error', {
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
              emit(userId, 'page_done', {
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
              emit(userId, 'page_error', {
                pageId: pp.pageId,
                error: message,
                progress: Math.round((completed / total) * 100),
              });
            }
          }

          batchSuccess = true;
          await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Neznámá chyba';
          console.warn(
            `[BatchProcess] Batch ${batchNumber} failed: ${message}, falling back to individual processing`,
          );
          batchSuccess = false;
        }

        // Fallback: process individually if batch failed
        if (!batchSuccess) {
          for (const pp of batchPages) {
            if (signal.aborted) {
              try {
                await prisma.page.update({
                  where: { id: pp.pageId },
                  data: { status: 'pending' },
                });
              } catch {
                // ignore
              }
              continue;
            }

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
                    emit(userId, 'page_progress', {
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
              emit(userId, 'page_done', {
                pageId: pp.pageId,
                documentId: doc.id,
                cached: false,
                progress: Math.round((completed / total) * 100),
              });
              await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Neznámá chyba';
              console.error(`[BatchProcess] Page ${pp.pageId} error [fallback]:`, message);

              try {
                await prisma.page.update({
                  where: { id: pp.pageId },
                  data: { status: 'error', errorMessage: message },
                });
              } catch {
                // ignore
              }

              completed++;
              emit(userId, 'page_error', {
                pageId: pp.pageId,
                error: message,
                progress: Math.round((completed / total) * 100),
              });
            }
          }

          if (signal.aborted) {
            emit(userId, 'cancelled', { message: 'Zpracování zrušeno uživatelem' });
            return;
          }
        }
      }
    }

    emit(userId, 'done', { total, completed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Neznámá chyba';
    console.error(`[BatchProcess] Fatal error:`, message);
    emit(userId, 'done', { total, completed, error: message });
  } finally {
    completeJob(userId);
  }
}

// ── SSE stream helper ───────────────────────────────────────

function createStatusStream(userId: string): Response {
  const job = getActiveJob(userId);
  if (!job) {
    return Response.json({ status: 'idle' });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Replay all buffered events
      for (const evt of job.events) {
        controller.enqueue(
          encoder.encode(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`),
        );
      }

      if (job.completed) {
        controller.close();
        return;
      }

      // Subscribe to live events
      const listener = (evt: ProcessingEvent): void => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`),
          );
          if (evt.event === 'done' || evt.event === 'cancelled') {
            controller.close();
          }
        } catch {
          job.listeners.delete(listener);
        }
      };
      job.listeners.add(listener);
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

// ── POST: Start processing ──────────────────────────────────

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

  const {
    pageIds,
    language,
    mode: rawMode,
  } = body as {
    pageIds: unknown;
    language?: unknown;
    mode?: unknown;
  };

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

  // Create job (throws if one is already running)
  let job;
  try {
    job = createJob(userId, pageIds as string[]);
  } catch {
    return Response.json({ error: 'Již probíhá zpracování' }, { status: 409 });
  }

  // Start processing in background — NOT tied to this response
  void runProcessing(
    userId,
    pageIds as string[],
    targetLang,
    processingMode,
    job.abortController.signal,
  );

  // Return SSE stream so the client can immediately start receiving events
  return createStatusStream(userId);
}

// ── GET: Reconnect to running job ───────────────────────────

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return Response.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  return createStatusStream(userId);
}
