import { inngest } from '@/lib/infrastructure/inngest';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaudeBatch } from '@/lib/adapters/ocr/claude-vision';
import type { ProcessingMode } from '@/lib/adapters/ocr/claude-vision';
import { checkBalance, deductTokensIfSufficient } from '@/lib/infrastructure/billing';
import {
  getPreviousPageContext,
  saveDocumentResult,
  copyDocumentForPage,
  loadImageAndHash,
} from '@/lib/infrastructure/processing-helpers';
import { createBatches, estimateImageTokens } from '@/lib/batch-utils';

interface PreparedPage {
  pageId: string;
  imageBuffer: string; // base64-encoded buffer for serialization across steps
  imageHash: string;
  fileSize: number;
  collectionId: string | null;
  collectionContext: string | null;
  existingDocId: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const processPages: any = inngest.createFunction(
  {
    id: 'process-pages',
    retries: 2,
    concurrency: [
      {
        key: 'event.data.userId',
        limit: 1,
      },
    ],
    triggers: [{ event: 'pages.process' }],
  },
  async ({ event, step }) => {
    const {
      jobId,
      userId,
      pageIds: rawPageIds,
      collectionId,
      language,
      mode,
    } = event.data as {
      jobId: string;
      userId: string;
      pageIds: string[];
      collectionId?: string;
      language: string;
      mode: ProcessingMode;
    };

    // ── Step 1: Sort pages by order ──────────────────────────────
    const pageIds = await step.run('sort-pages', async () => {
      const pages = await prisma.page.findMany({
        where: { id: { in: rawPageIds } },
        select: { id: true, order: true },
        orderBy: { order: 'asc' },
      });
      const ordered = pages.filter((p) => p.order !== null).map((p) => p.id);
      const orderedSet = new Set(ordered);
      const unordered = rawPageIds.filter((id) => !orderedSet.has(id));
      return [...ordered, ...unordered];
    });

    const total = pageIds.length;
    let completed = 0;
    const errors: string[] = [];

    // ── Step 2: Prepare pages (skip blank, already-translated, dedup, load images) ──
    const prepareResult = await step.run('prepare-pages', async () => {
      const avgResult = await prisma.document.aggregate({
        _avg: { outputTokens: true },
        where: { outputTokens: { not: null } },
      });
      const avgOutputPerPage = Math.round(avgResult._avg.outputTokens ?? 1500);

      const pagesToProcess: PreparedPage[] = [];
      const skippedCount = { blank: 0, alreadyTranslated: 0, deduped: 0, notFound: 0 };

      for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i]!;

        // Update progress during preparation
        if (i % 3 === 0 || i === pageIds.length - 1) {
          await prisma.processingJob.update({
            where: { id: jobId },
            data: {
              currentStep: `Příprava stránek ${i + 1}/${pageIds.length}…`,
            },
          });
        }

        if (typeof pageId !== 'string') {
          skippedCount.notFound++;
          continue;
        }

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
          errors.push(`Stránka ${pageId} nenalezena`);
          skippedCount.notFound++;
          continue;
        }

        // Skip blank pages
        if (page.status === 'blank') {
          skippedCount.blank++;
          continue;
        }

        // Skip pages with existing translation
        if (page.document !== null) {
          const hasTranslation = page.document.translations.some(
            (t: { language: string }) => t.language === language,
          );
          if (hasTranslation) {
            skippedCount.alreadyTranslated++;
            continue;
          }
        }

        // Set page to processing
        await prisma.page.update({
          where: { id: pageId },
          data: { status: 'processing', errorMessage: null },
        });

        // Load image and compute hash
        const { imageBuffer, imageHash } = await loadImageAndHash(page.imageUrl);

        // Check for existing document with same hash (cross-user dedup)
        const existingByHash = await prisma.document.findFirst({
          where: { hash: imageHash },
          include: { translations: true, glossary: true },
        });

        if (existingByHash !== null && page.document === null) {
          // Dedup: copy existing document instead of re-processing
          const copiedDoc = await copyDocumentForPage(pageId, existingByHash);

          const origInput = existingByHash.inputTokens ?? 0;
          const origOutput = existingByHash.outputTokens ?? 0;
          if (origInput + origOutput > 0) {
            await deductTokensIfSufficient(
              userId,
              origInput,
              origOutput,
              `OCR stránky ${pageId} (deduplikace)`,
              `copy-${copiedDoc.id}`,
            );
          }

          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'done', errorMessage: null },
          });

          skippedCount.deduped++;
          continue;
        }

        pagesToProcess.push({
          pageId,
          imageBuffer: imageBuffer.toString('base64'),
          imageHash,
          fileSize: imageBuffer.length,
          collectionId: page.collection?.id ?? collectionId ?? null,
          collectionContext: page.collection?.context ?? null,
          existingDocId: page.document?.id ?? null,
        });
      }

      // Update job progress for skipped pages
      const totalSkipped =
        skippedCount.blank +
        skippedCount.alreadyTranslated +
        skippedCount.deduped +
        skippedCount.notFound;

      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          completedPages: totalSkipped,
          currentStep: `Připraveno ${pagesToProcess.length} stránek ke zpracování (${totalSkipped} přeskočeno)`,
        },
      });

      return { pagesToProcess, skippedCount, avgOutputPerPage };
    });

    const { pagesToProcess, skippedCount, avgOutputPerPage } = prepareResult;
    completed =
      skippedCount.blank +
      skippedCount.alreadyTranslated +
      skippedCount.deduped +
      skippedCount.notFound;

    // If nothing to process, finish early
    if (pagesToProcess.length === 0) {
      await step.run('complete-job', async () => {
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: 'completed',
            currentStep: 'Hotovo',
            completedPages: total,
          },
        });
      });
      return { status: 'completed', completed: total, total };
    }

    // ── Step 3: Create batches ───────────────────────────────────
    const batchPages = pagesToProcess.map((p) => ({
      ...p,
      id: p.pageId,
    }));

    const batches = createBatches(batchPages, {
      inputTokenBudget: 180_000,
      maxOutputTokens: 16_000,
      avgOutputPerPage,
    });

    // ── Step 4: Process each batch ───────────────────────────────
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;

      // Check balance before each batch
      const balanceOk = await step.run(`check-balance-${batchIdx}`, async () => {
        const { sufficient } = await checkBalance(userId);
        if (!sufficient) {
          // Reset remaining pages to pending
          const remainingPageIds = batches
            .slice(batchIdx)
            .flat()
            .map((p) => p.pageId);
          if (remainingPageIds.length > 0) {
            await prisma.page.updateMany({
              where: { id: { in: remainingPageIds }, status: 'processing' },
              data: { status: 'pending' },
            });
          }
          errors.push('Nedostatečný kredit pro zpracování');
          await prisma.processingJob.update({
            where: { id: jobId },
            data: {
              status: 'error',
              completedPages: completed,
              errors,
              currentStep: 'Nedostatečný kredit',
            },
          });
          return false;
        }
        return true;
      });

      if (!balanceOk) {
        return { status: 'error', completed, errors };
      }

      // Process the batch
      const batchResult = await step.run(`batch-${batchIdx}`, async () => {
        const batchPageIds = batch.map((p) => p.pageId);

        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            currentStep: `Zpracovávám dávku ${batchIdx + 1}/${batches.length} (${batch.length} stránek)…`,
          },
        });

        // Get previous context from the first page's collection
        const firstPage = batch[0]!;
        const previousContext = await getPreviousPageContext(
          firstPage.collectionId,
          firstPage.pageId,
        );

        // Build user prompt
        let userPrompt = 'Přepiš text z tohoto rukopisu.';
        const batchCollectionContext = firstPage.collectionContext;
        if (batchCollectionContext) {
          userPrompt = `Kontext díla (použij pro lepší porozumění dokumentu):\n${batchCollectionContext}\n\n---\n\nPřepiš text z tohoto rukopisu.`;
        }

        // Prepare images for the batch call
        const images = batch.map((p, idx) => ({
          buffer: Buffer.from(p.imageBuffer, 'base64'),
          pageId: p.pageId,
          index: idx,
        }));

        // Call Claude with all images in the batch at once
        const estimatedTotal = avgOutputPerPage * batch.length;
        let lastProgressUpdate = 0;

        const { results, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
          await processWithClaudeBatch(images, userPrompt, {
            collectionContext: batchCollectionContext ?? undefined,
            previousContext,
            estimatedOutputTokens: estimatedTotal,
            mode,
            onProgress: (currentTokens, estimated) => {
              // Throttle DB updates to every 2 seconds
              const now = Date.now();
              if (now - lastProgressUpdate < 2000) return;
              lastProgressUpdate = now;

              const pct = Math.min(99, Math.round((currentTokens / estimated) * 100));
              void prisma.processingJob
                .update({
                  where: { id: jobId },
                  data: {
                    currentStep: `Dávka ${batchIdx + 1}/${batches.length} — ${currentTokens.toLocaleString('cs')} / ~${estimated.toLocaleString('cs')} tokenů (${pct}%)`,
                  },
                })
                .catch(() => {});
            },
          });

        // Distribute tokens proportionally across pages in the batch
        const perPageInputTokens = Math.round(inputTokens / batch.length);
        const perPageOutputTokens = Math.round(outputTokens / batch.length);
        const perPageProcessingTimeMs = Math.round(processingTimeMs / batch.length);

        // Save results for each page
        const savedDocs: { pageId: string; docId: string }[] = [];
        for (const { index, result } of results) {
          const pageInfo = batch[index];
          if (!pageInfo) continue;

          try {
            const doc = await saveDocumentResult(
              pageInfo.pageId,
              pageInfo.existingDocId ? { id: pageInfo.existingDocId } : null,
              pageInfo.imageHash,
              result,
              rawResponse,
              {
                model,
                inputTokens: perPageInputTokens,
                outputTokens: perPageOutputTokens,
                processingTimeMs: perPageProcessingTimeMs,
              },
              language,
            );

            savedDocs.push({ pageId: pageInfo.pageId, docId: doc.id });

            await prisma.page.update({
              where: { id: pageInfo.pageId },
              data: { status: 'done', errorMessage: null },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Neznámá chyba';
            console.error(`[Inngest] Save failed for page ${pageInfo.pageId}:`, message);
            errors.push(`Stránka ${pageInfo.pageId}: ${message}`);

            await prisma.page.update({
              where: { id: pageInfo.pageId },
              data: { status: 'error', errorMessage: message },
            });
          }
        }

        // Handle pages that didn't get a result (model returned fewer results than images)
        const processedIndices = new Set(results.map((r) => r.index));
        for (let idx = 0; idx < batch.length; idx++) {
          if (!processedIndices.has(idx)) {
            const pageInfo = batch[idx]!;
            const message = 'Model nevrátil výsledek pro tuto stránku';
            errors.push(`Stránka ${pageInfo.pageId}: ${message}`);
            await prisma.page.update({
              where: { id: pageInfo.pageId },
              data: { status: 'error', errorMessage: message },
            });
          }
        }

        // Deduct tokens for the whole batch
        const deductResult = await deductTokensIfSufficient(
          userId,
          inputTokens,
          outputTokens,
          `OCR dávka ${batchIdx + 1} (${batch.length} stránek)`,
          savedDocs.length > 0 ? savedDocs[0]!.docId : `batch-${batchIdx}`,
        );

        // Update completed count
        const batchCompleted = batch.length;

        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            completedPages: completed + batchCompleted,
            currentStep: `Dávka ${batchIdx + 1}/${batches.length} hotova`,
          },
        });

        console.log(
          `[Inngest] Batch ${batchIdx + 1}/${batches.length} done: ${batch.length} pages in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
        );

        return {
          pagesProcessed: batchCompleted,
          insufficientTokens: !deductResult.success,
          savedDocs,
        };
      });

      completed += batchResult.pagesProcessed;

      // If deduction failed, stop further batches
      if (batchResult.insufficientTokens) {
        // Reset remaining batches' pages to pending
        const remainingPageIds = batches
          .slice(batchIdx + 1)
          .flat()
          .map((p) => p.pageId);
        if (remainingPageIds.length > 0) {
          await step.run(`reset-remaining-${batchIdx}`, async () => {
            await prisma.page.updateMany({
              where: { id: { in: remainingPageIds }, status: 'processing' },
              data: { status: 'pending' },
            });
            errors.push('Nedostatečný kredit pro další zpracování');
            await prisma.processingJob.update({
              where: { id: jobId },
              data: {
                status: 'error',
                completedPages: completed,
                errors,
                currentStep: 'Nedostatečný kredit',
              },
            });
          });
        }
        return { status: 'error', completed, errors };
      }

      // Check if job was cancelled between batches
      const jobStatus = await step.run(`check-cancel-${batchIdx}`, async () => {
        const job = await prisma.processingJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        return job?.status ?? 'running';
      });

      if (jobStatus === 'cancelled') {
        await step.run('cancel-cleanup', async () => {
          const remainingPageIds = batches
            .slice(batchIdx + 1)
            .flat()
            .map((p) => p.pageId);
          if (remainingPageIds.length > 0) {
            await prisma.page.updateMany({
              where: { id: { in: remainingPageIds }, status: 'processing' },
              data: { status: 'pending' },
            });
          }
        });
        return { status: 'cancelled', completed };
      }

      if (jobStatus === 'error') {
        return { status: 'error', completed, errors };
      }
    }

    // ── Step 5: Complete job ─────────────────────────────────────
    await step.run('complete-job', async () => {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          currentStep: 'Hotovo',
          completedPages: total,
        },
      });
    });

    return { status: 'completed', completed, total };
  },
);
