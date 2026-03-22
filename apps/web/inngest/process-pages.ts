import { inngest } from '@/lib/infrastructure/inngest';
import { prisma } from '@/lib/infrastructure/db';
import { processWithClaude } from '@/lib/adapters/ocr/claude-vision';
import type { ProcessingMode } from '@/lib/adapters/ocr/claude-vision';
import { checkBalance, deductTokensIfSufficient } from '@/lib/infrastructure/billing';
import {
  getPreviousPageContext,
  saveDocumentResult,
  copyDocumentForPage,
  loadImageAndHash,
} from '@/lib/infrastructure/processing-helpers';

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
    const { jobId, userId, pageIds, collectionId, language, mode } = event.data as {
      jobId: string;
      userId: string;
      pageIds: string[];
      collectionId?: string;
      language: string;
      mode: ProcessingMode;
    };

    const total = pageIds.length;
    let completed = 0;
    const errors: string[] = [];

    // Get average output tokens for estimation
    const avgResult = await step.run('get-avg-tokens', async () => {
      const result = await prisma.document.aggregate({
        _avg: { outputTokens: true },
        where: { outputTokens: { not: null } },
      });
      return Math.round(result._avg.outputTokens ?? 1500);
    });
    const estimatedTokens = avgResult;

    for (let i = 0; i < pageIds.length; i++) {
      const pageId = pageIds[i]!;

      await step.run(`process-page-${i}-${pageId}`, async () => {
        // Check if job was cancelled
        const job = await prisma.processingJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        if (!job || job.status === 'cancelled') {
          // Mark remaining pages back to pending
          const remainingIds = pageIds.slice(i);
          await prisma.page.updateMany({
            where: { id: { in: remainingIds }, status: 'processing' },
            data: { status: 'pending' },
          });
          return { action: 'cancelled' as const };
        }

        // Update job progress
        await prisma.processingJob.update({
          where: { id: jobId },
          data: {
            currentPageId: pageId,
            currentStep: `Zpracovávám stránku ${i + 1}/${total}…`,
          },
        });

        if (typeof pageId !== 'string') {
          errors.push(`Neplatné ID stránky: ${pageId}`);
          completed++;
          await prisma.processingJob.update({
            where: { id: jobId },
            data: { completedPages: completed, errors },
          });
          return { action: 'skipped' as const, reason: 'invalid-id' };
        }

        try {
          // Load page from DB
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
            completed++;
            await prisma.processingJob.update({
              where: { id: jobId },
              data: { completedPages: completed, errors },
            });
            return { action: 'skipped' as const, reason: 'not-found' };
          }

          // Skip blank pages
          if (page.status === 'blank') {
            completed++;
            await prisma.processingJob.update({
              where: { id: jobId },
              data: {
                completedPages: completed,
                currentStep: `Přeskakuji prázdnou stránku ${i + 1}/${total}`,
              },
            });
            return { action: 'skipped' as const, reason: 'blank' };
          }

          // Skip already-done pages with existing translation
          if (page.document !== null) {
            const targetLang = language;
            const hasTranslation = page.document.translations.some(
              (t: { language: string }) => t.language === targetLang,
            );
            if (hasTranslation) {
              completed++;
              await prisma.processingJob.update({
                where: { id: jobId },
                data: {
                  completedPages: completed,
                  currentStep: `Přeskakuji – překlad existuje ${i + 1}/${total}`,
                },
              });
              return { action: 'skipped' as const, reason: 'already-translated' };
            }
          }

          // Set page status to processing
          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'processing', errorMessage: null },
          });

          await prisma.processingJob.update({
            where: { id: jobId },
            data: { currentStep: `Načítám obrázek ${i + 1}/${total}…` },
          });

          // Load image and compute hash
          const { imageBuffer, imageHash } = await loadImageAndHash(page.imageUrl);

          // Check for existing document with same hash (cross-user dedup)
          const existingByHash = await prisma.document.findFirst({
            where: { hash: imageHash },
            include: { translations: true, glossary: true },
          });

          if (existingByHash !== null && page.document === null) {
            // Dedup: copy existing document
            await prisma.processingJob.update({
              where: { id: jobId },
              data: {
                currentStep: `Kopíruji existující dokument (deduplikace) ${i + 1}/${total}…`,
              },
            });

            const copiedDoc = await copyDocumentForPage(pageId, existingByHash);

            // Charge tokens based on original document's usage
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

            completed++;
            await prisma.processingJob.update({
              where: { id: jobId },
              data: {
                completedPages: completed,
                currentStep: `Hotovo (deduplikace) ${i + 1}/${total}`,
              },
            });
            return { action: 'done' as const, documentId: copiedDoc.id, cached: true };
          }

          // Check balance before calling Claude
          const { sufficient: hasTokens } = await checkBalance(userId);
          if (!hasTokens) {
            await prisma.page.update({
              where: { id: pageId },
              data: { status: 'pending' },
            });
            // Also reset remaining pages
            const remainingIds = pageIds.slice(i + 1);
            if (remainingIds.length > 0) {
              await prisma.page.updateMany({
                where: { id: { in: remainingIds }, status: 'processing' },
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
            return { action: 'insufficient-tokens' as const };
          }

          // Call Claude for OCR
          await prisma.processingJob.update({
            where: { id: jobId },
            data: { currentStep: `Volám model… ${i + 1}/${total}` },
          });

          const previousContext = await getPreviousPageContext(
            page.collection?.id ?? collectionId ?? null,
            pageId,
          );

          let userPrompt = 'Přepiš text z tohoto rukopisu.';
          const collectionContext = page.collection?.context;
          if (collectionContext) {
            userPrompt = `Kontext díla (použij pro lepší porozumění dokumentu):\n${collectionContext}\n\n---\n\nPřepiš text z tohoto rukopisu.`;
          }

          const { result, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
            await processWithClaude(
              imageBuffer,
              userPrompt,
              undefined, // no onProgress callback in Inngest (no SSE)
              estimatedTokens,
              previousContext,
              mode,
            );

          console.log(
            `[Inngest] Page ${pageId} done in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
          );

          // Save result
          const doc = await saveDocumentResult(
            pageId,
            page.document,
            imageHash,
            result,
            rawResponse,
            { model, inputTokens, outputTokens, processingTimeMs },
            language,
          );

          // Deduct tokens
          const deductResult = await deductTokensIfSufficient(
            userId,
            inputTokens,
            outputTokens,
            `OCR stránky ${pageId}`,
            doc.id,
          );

          if (!deductResult.success) {
            // Work already done, mark as done but stop further processing
            await prisma.page.update({
              where: { id: pageId },
              data: { status: 'done', errorMessage: null },
            });
            completed++;
            // Reset remaining pages
            const remainingIds = pageIds.slice(i + 1);
            if (remainingIds.length > 0) {
              await prisma.page.updateMany({
                where: { id: { in: remainingIds }, status: 'processing' },
                data: { status: 'pending' },
              });
            }
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
            return { action: 'insufficient-tokens' as const };
          }

          // Mark page as done
          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'done', errorMessage: null },
          });

          completed++;
          await prisma.processingJob.update({
            where: { id: jobId },
            data: {
              completedPages: completed,
              currentStep: `Hotovo ${i + 1}/${total}`,
            },
          });

          return { action: 'done' as const, documentId: doc.id, cached: false };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Neznámá chyba';
          console.error(`[Inngest] Page ${pageId} error:`, message);

          try {
            await prisma.page.update({
              where: { id: pageId },
              data: { status: 'error', errorMessage: message },
            });
          } catch {
            // ignore
          }

          errors.push(`Stránka ${pageId}: ${message}`);
          completed++;
          await prisma.processingJob.update({
            where: { id: jobId },
            data: { completedPages: completed, errors },
          });

          return { action: 'error' as const, error: message };
        }
      });

      // After each step, re-check if cancelled (job status might have changed)
      const jobStatus = await step.run(`check-cancel-${i}`, async () => {
        const job = await prisma.processingJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        return job?.status ?? 'running';
      });

      if (jobStatus === 'cancelled') {
        // Mark remaining processing pages back to pending
        await step.run('cancel-cleanup', async () => {
          const remainingIds = pageIds.slice(i + 1);
          if (remainingIds.length > 0) {
            await prisma.page.updateMany({
              where: { id: { in: remainingIds }, status: 'processing' },
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

    // All pages processed — mark job completed
    await step.run('complete-job', async () => {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          currentStep: 'Hotovo',
          completedPages: completed,
        },
      });
    });

    return { status: 'completed', completed, total };
  },
);
