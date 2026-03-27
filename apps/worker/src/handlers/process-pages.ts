/**
 * OCR page processing job handler.
 *
 * Runs as plain async code in a long-lived worker process (no timeout).
 * Called from worker/index.ts when a queued ProcessingJob is found in DB.
 */

import { LANGUAGE_NAMES } from '../lib/languages';
import { createMessage, isCliMode } from '../lib/llm';
import { prisma } from '@ai-sedlacek/db';
import { checkBalance, deductTokensIfSufficient } from '@ai-sedlacek/db/billing';
import { processWithClaudeBatch, processWithClaudeBatchCli } from '@ai-sedlacek/ocr';
import type { ProcessingMode } from '@ai-sedlacek/ocr';
import {
  getPreviousPageContext,
  saveDocumentResult,
  copyDocumentForPage,
  loadImageAndHash,
} from '../lib/processing-helpers';
import { createBatches } from '../lib/batch-utils';

interface PreparedPage {
  pageId: string;
  imageBuffer: string; // base64-encoded
  imageHash: string;
  fileSize: number;
  collectionId: string | null;
  collectionContext: string | null;
  existingDocId: string | null;
}

export interface ProcessPagesJobData {
  jobId: string;
  userId: string;
  pageIds: string[];
  collectionId?: string;
  language: string;
  mode: ProcessingMode;
}

export async function processPages(data: ProcessPagesJobData): Promise<void> {
  const { jobId, userId, pageIds: rawPageIds, collectionId, language, mode } = data;

  // Load collection name for transaction descriptions
  let collectionName: string | null = null;
  if (collectionId) {
    const col = await prisma.collection.findUnique({
      where: { id: collectionId },
      select: { name: true },
    });
    collectionName = col?.name ?? null;
  }
  const collectionLabel = collectionName ? ` [${collectionName}]` : '';

  const errors: string[] = [];

  // ── Sort pages by order ──────────────────────────────
  const pages = await prisma.page.findMany({
    where: { id: { in: rawPageIds } },
    select: { id: true, order: true },
    orderBy: { order: 'asc' },
  });
  const ordered = pages.filter((p) => p.order !== null).map((p) => p.id);
  const orderedSet = new Set(ordered);
  const unordered = rawPageIds.filter((id) => !orderedSet.has(id));
  const pageIds = [...ordered, ...unordered];

  const total = pageIds.length;
  let completed = 0;

  // ── Prepare pages (skip blank, already-translated, dedup, load images) ──
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

    // Skip pages with existing translation in the target language
    if (page.document !== null) {
      const hasTranslation = page.document.translations.some(
        (t: { language: string }) => t.language === language,
      );
      if (hasTranslation) {
        skippedCount.alreadyTranslated++;
        continue;
      }

      // Document exists but no translation in target language → translate existing content
      const sourceTranslation = page.document.translations[0] as
        | { language: string; text: string }
        | undefined;
      if (sourceTranslation) {
        await prisma.page.update({
          where: { id: pageId },
          data: { status: 'processing', errorMessage: null },
        });

        try {
          await translateExistingDocument(
            jobId,
            userId,
            page.document as {
              id: string;
              context: string;
              glossary: { term: string; definition: string }[];
            },
            sourceTranslation,
            language,
            collectionLabel,
          );
          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'done', errorMessage: null },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Chyba překladu';
          errors.push(msg);
          await prisma.page.update({
            where: { id: pageId },
            data: { status: 'done', errorMessage: msg },
          });
        }

        completed++;
        await prisma.processingJob.update({
          where: { id: jobId },
          data: { completedPages: completed },
        });
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
          `OCR stránky ${pageId} (deduplikace)${collectionLabel}`,
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

  completed = totalSkipped;

  // If nothing to process, finish early
  if (pagesToProcess.length === 0) {
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        currentStep: 'Hotovo',
        completedPages: total,
      },
    });
    return;
  }

  // ── Create batches ───────────────────────────────────
  const batchPages = pagesToProcess.map((p) => ({
    ...p,
    id: p.pageId,
  }));

  const batches = createBatches(batchPages, {
    inputTokenBudget: 180_000,
    maxOutputTokens: 16_000,
    avgOutputPerPage: Math.max(avgOutputPerPage, 2500),
  });

  // ── Process each batch ───────────────────────────────
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;

    // Check balance before each batch
    const { sufficient } = await checkBalance(userId);
    if (!sufficient) {
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
      return;
    }

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        currentStep: `Zpracovávám dávku ${batchIdx + 1}/${batches.length} (${batch.length} stránek)…`,
      },
    });

    // Get previous context from the first page's collection
    const firstPage = batch[0]!;
    const previousContext = await getPreviousPageContext(firstPage.collectionId, firstPage.pageId);

    // Build user prompt — localized so Claude responds in the target language
    const transcribePrompt =
      language === 'en'
        ? 'Transcribe the text from this manuscript.'
        : 'Přepiš text z tohoto rukopisu.';
    const contextPrefix =
      language === 'en'
        ? 'Context of the work (use for better understanding of the document):'
        : 'Kontext díla (použij pro lepší porozumění dokumentu):';
    let userPrompt = transcribePrompt;
    const batchCollectionContext = firstPage.collectionContext;
    if (batchCollectionContext) {
      userPrompt = `${contextPrefix}\n${batchCollectionContext}\n\n---\n\n${transcribePrompt}`;
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

    const processBatch = isCliMode() ? processWithClaudeBatchCli : processWithClaudeBatch;
    const { results, rawResponse, processingTimeMs, model, inputTokens, outputTokens } =
      await processBatch(images, userPrompt, {
        collectionContext: batchCollectionContext ?? undefined,
        previousContext,
        estimatedOutputTokens: estimatedTotal,
        mode,
        onProgress: (currentTokens, estimated) => {
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
        console.error(`[Worker] Save failed for page ${pageInfo.pageId}:`, message);
        errors.push(`Stránka ${pageInfo.pageId}: ${message}`);

        await prisma.page.update({
          where: { id: pageInfo.pageId },
          data: { status: 'error', errorMessage: message },
        });
      }
    }

    // Handle pages that didn't get a result
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
      `OCR dávka ${batchIdx + 1} (${batch.length} stránek)${collectionLabel}`,
      savedDocs.length > 0 ? savedDocs[0]!.docId : `batch-${batchIdx}`,
    );

    // Update completed count
    const batchCompleted = batch.length;
    completed += batchCompleted;

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        completedPages: completed,
        currentStep: `Dávka ${batchIdx + 1}/${batches.length} hotova`,
      },
    });

    console.log(
      `[Worker] Batch ${batchIdx + 1}/${batches.length} done: ${batch.length} pages in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
    );

    // If deduction failed, stop further batches
    if (!deductResult.success) {
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
      return;
    }

    // Check if job was cancelled between batches
    const jobRecord = await prisma.processingJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    const jobStatus = jobRecord?.status ?? 'running';

    if (jobStatus === 'cancelled') {
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
      return;
    }

    if (jobStatus === 'error') {
      return;
    }
  }

  // ── Complete job ─────────────────────────────────────
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      currentStep: 'Hotovo',
      completedPages: total,
    },
  });
}

/**
 * Translate an existing document's translation, context, and glossary
 * from one language to another using Claude Sonnet.
 */
async function translateExistingDocument(
  jobId: string,
  userId: string,
  doc: { id: string; context: string; glossary: { term: string; definition: string }[] },
  sourceTranslation: { language: string; text: string },
  targetLanguage: string,
  collectionLabel: string,
): Promise<void> {
  const sourceLang = LANGUAGE_NAMES[sourceTranslation.language] ?? sourceTranslation.language;
  const targetLang = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: `Překládám do ${targetLang}…` },
  });

  // Build a single prompt that translates translation + context + glossary
  const glossaryText =
    doc.glossary.length > 0
      ? doc.glossary.map((g) => `- **${g.term}**: ${g.definition}`).join('\n')
      : '';

  const prompt = `Translate the following historical manuscript data from ${sourceLang} to ${targetLang}. Keep all markdown formatting intact. Translate naturally — this is scholarly/academic text.

Return your response as valid JSON with this exact structure:
{
  "translation": "the translated text in markdown",
  "context": "the translated context in markdown",
  "glossary": [{"term": "translated term", "definition": "translated definition"}]
}

=== TRANSLATION ===
${sourceTranslation.text}

=== CONTEXT ===
${doc.context || '(empty)'}

=== GLOSSARY ===
${glossaryText || '(empty)'}

Return ONLY the JSON object, no markdown fences, no extra text.`;

  const response = await createMessage({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.text;

  let parsed: {
    translation: string;
    context: string;
    glossary: { term: string; definition: string }[];
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback: treat the whole response as translation text
    parsed = { translation: text, context: '', glossary: [] };
  }

  // Save the translated content
  await prisma.translation.upsert({
    where: { documentId_language: { documentId: doc.id, language: targetLanguage } },
    update: {
      text: parsed.translation,
      context: parsed.context || null,
      glossaryJson: parsed.glossary?.length > 0 ? JSON.stringify(parsed.glossary) : null,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
    create: {
      documentId: doc.id,
      language: targetLanguage,
      text: parsed.translation,
      context: parsed.context || null,
      glossaryJson: parsed.glossary?.length > 0 ? JSON.stringify(parsed.glossary) : null,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
  });

  // Deduct tokens
  await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Překlad dokumentu ${doc.id}${collectionLabel}`,
    `translate-doc-${doc.id}-${targetLanguage}-${Date.now()}`,
  ).catch(() => {});
}
