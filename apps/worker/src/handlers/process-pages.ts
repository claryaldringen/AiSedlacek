/**
 * OCR page processing job handler.
 *
 * Runs as plain async code in a long-lived worker process (no timeout).
 * Called from worker/index.ts when a queued ProcessingJob is found in DB.
 */

import crypto from 'crypto';
import { LANGUAGE_NAMES } from '../lib/languages';
import { isCliMode } from '../lib/llm';
import { chargedCreditsOf, createBilledMessage } from '../lib/billed-message';
import { prisma } from '@ai-sedlacek/db';
import {
  consumeCredits,
  getCreditState,
  releaseCreditHold,
  reserveCredits,
  settleCreditHold,
  settledCredits,
  type CreditCharge,
} from '@ai-sedlacek/db/billing';
import {
  OcrRefusalError,
  ocrBatchReservationCredits,
  prepareImage,
  processWithClaudeBatch,
  processWithClaudeBatchCli,
} from '@ai-sedlacek/ocr';
import type { OcrAttemptUsage, ProcessingMode } from '@ai-sedlacek/ocr';
import {
  getPreviousPageContext,
  saveDocumentResult,
  regenerateDocumentResult,
  copyDocumentForPage,
  findDedupSourceDocument,
  hashImage,
  loadImage,
} from '../lib/processing-helpers';
import { resetUnfinishedPages, setPageStatus } from '../lib/page-status';
import { errorsKeepingReclaimMarkers } from '../lib/reclaim';
import { createBatches } from '../lib/batch-utils';
import { LLM_MAX_TOKENS, OCR_MODEL, TEXT_MODEL, isRefusalBilled } from '@ai-sedlacek/shared';

/**
 * Hláška pro stránku, jejíž obrázek nejde načíst z úložiště (chybí soubor apod.).
 * Původní chyba (se serverovou cestou) jde jen do logu, ne k uživateli.
 */
export const IMAGE_UNREADABLE_MESSAGE = 'Obrázek stránky nelze načíst';

/** Volný kredit nestačí na rezervaci další dávky nebo kopie (BIL-1). */
export function insufficientCreditMessage(required: number, available: number): string {
  return (
    'Nedostatečný kredit pro zpracování – další krok potřebuje rezervovat ' +
    `${required.toLocaleString('cs')} tokenů, volných je ${Math.max(0, available).toLocaleString('cs')}`
  );
}

interface PreparedPage {
  pageId: string;
  // Jen odkaz na obrázek – samotná data se načtou až pro konkrétní dávku (PERF-1)
  imageUrl: string;
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
  /**
   * Regenerace (DAT-1, `jobData = {"regenerate": true}`): stránky s existujícím
   * dokumentem se nepřeskakují ani nededuplikují, projdou OCR a výsledek se zapíše
   * do EXISTUJÍCÍHO dokumentu (předchozí hodnoty jako verze `ai_regenerate`).
   */
  regenerate?: boolean;
}

export async function processPages(data: ProcessPagesJobData): Promise<void> {
  const {
    jobId,
    userId,
    pageIds: rawPageIds,
    collectionId,
    language,
    mode,
    regenerate = false,
  } = data;

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
  const skippedCount = {
    blank: 0,
    alreadyTranslated: 0,
    alreadyRegenerated: 0,
    deduped: 0,
    notFound: 0,
    imageUnreadable: 0,
    insufficientCredit: 0,
  };

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
            translations: { select: { language: true, text: true } },
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

    // Archivovanou („smazanou") stránku nezpracovávat – zápis done/error by ji
    // odarchivoval a ve veřejném svazku znovu zveřejnil.
    if (page.status === 'archived') {
      skippedCount.notFound++;
      continue;
    }

    // Regenerace: stránku, kterou tento job už přegeneroval (batchId = jobId),
    // po restartu workeru znovu neposílat – zbytečně by se platilo podruhé.
    if (regenerate && page.document !== null && page.document.batchId === jobId) {
      await setPageStatus(pageId, 'done');
      skippedCount.alreadyRegenerated++;
      continue;
    }

    // Skip pages with existing translation in the target language
    // (při regeneraci se stránky s dokumentem naopak zpracují znovu)
    if (page.document !== null && !regenerate) {
      const hasTranslation = page.document.translations.some(
        (t: { language: string }) => t.language === language,
      );
      if (hasTranslation) {
        // Web při spuštění jobu přepne stránky na 'processing' – přeskočenou
        // stránku je nutné vrátit, jinak v UI visí jako zpracovávaná.
        await setPageStatus(pageId, 'done');
        skippedCount.alreadyTranslated++;
        continue;
      }

      // Document exists but no translation in target language → translate existing content
      const sourceTranslation = page.document.translations[0] as
        | { language: string; text: string }
        | undefined;
      if (sourceTranslation) {
        await setPageStatus(pageId, 'processing');

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
            page.collection?.id ?? collectionId ?? null,
          );
          await setPageStatus(pageId, 'done');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Chyba překladu';
          errors.push(msg);
          await setPageStatus(pageId, 'done', msg);
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
    await setPageStatus(pageId, 'processing');

    // Hash obrázku (buffer se hned zahodí, viz hashImage). Chybějící nebo
    // nečitelný soubor skončí chybou jen u této stránky, ne celého jobu.
    let imageHash: string;
    let fileSize: number;
    try {
      ({ imageHash, fileSize } = await hashImage(page.imageUrl));
    } catch (err) {
      console.error(
        `[Worker] Image of page ${pageId} cannot be read:`,
        err instanceof Error ? err.message : err,
      );
      errors.push(`Stránka ${pageId}: ${IMAGE_UNREADABLE_MESSAGE}`);
      await markPageFailed(pageId, page.document?.id ?? null, IMAGE_UNREADABLE_MESSAGE);
      skippedCount.imageUnreadable++;
      continue;
    }

    // Dedup: existující dokument se stejným hashem – jen v rámci téhož uživatele
    // a jen z výstupu API (SEC-2, viz findDedupSourceDocument). Regenerace se
    // nikdy nededuplikuje – uživatel chce nový výstup modelu.
    const existingByHash =
      !regenerate && page.document === null
        ? await findDedupSourceDocument(userId, imageHash)
        : null;

    if (existingByHash !== null) {
      // Dedup: kopie existujícího dokumentu místo nového OCR. Účtuje se cena
      // původního zpracování podle jeho modelu – PŘED kopií a jen z volného
      // kreditu (BIL-1: zůstatek nesmí do minusu a kopie nesmí být zadarmo).
      const origInput = existingByHash.inputTokens ?? 0;
      const origOutput = existingByHash.outputTokens ?? 0;
      let copyCharged: number | null = null;
      if (origInput + origOutput > 0) {
        const charged = await consumeCredits(userId, {
          referenceId: dedupReferenceId(pageId, existingByHash.id),
          description: `OCR stránky ${pageId} (deduplikace)${collectionLabel}`,
          model: existingByHash.model ?? OCR_MODEL,
          inputTokens: origInput,
          outputTokens: origOutput,
          collectionId: page.collection?.id ?? collectionId ?? null,
        });
        if (charged.ok) copyCharged = settledCredits(charged.result);
        if (!charged.ok) {
          const message = insufficientCreditMessage(charged.required, charged.available);
          errors.push(`Stránka ${pageId}: ${message}`);
          await setPageStatus(pageId, 'pending', message);
          skippedCount.insufficientCredit++;
          continue;
        }
      }
      const copiedDoc = await copyDocumentForPage(pageId, existingByHash, copyCharged);

      // Check if copied document has translation in target language
      const hasTargetTranslation = existingByHash.translations.some(
        (t: { language: string }) => t.language === language,
      );

      if (!hasTargetTranslation) {
        const sourceTranslation = existingByHash.translations[0] as
          | { language: string; text: string }
          | undefined;
        if (sourceTranslation) {
          try {
            await translateExistingDocument(
              jobId,
              userId,
              {
                id: copiedDoc.id,
                context: existingByHash.context,
                glossary: existingByHash.glossary,
              },
              sourceTranslation,
              language,
              collectionLabel,
              page.collection?.id ?? collectionId ?? null,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Chyba překladu';
            errors.push(msg);
          }
        }
      }

      await setPageStatus(pageId, 'done');

      skippedCount.deduped++;
      completed++;
      await prisma.processingJob.update({
        where: { id: jobId },
        data: { completedPages: completed },
      });
      continue;
    }

    pagesToProcess.push({
      pageId,
      imageUrl: page.imageUrl,
      imageHash,
      fileSize,
      collectionId: page.collection?.id ?? collectionId ?? null,
      collectionContext: page.collection?.context ?? null,
      existingDocId: page.document?.id ?? null,
    });
  }

  // Update job progress for skipped pages
  const totalSkipped =
    skippedCount.blank +
    skippedCount.alreadyTranslated +
    skippedCount.alreadyRegenerated +
    skippedCount.deduped +
    skippedCount.notFound +
    skippedCount.imageUnreadable +
    skippedCount.insufficientCredit;

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
        status: errors.length > 0 && errors.length >= total ? 'error' : 'completed',
        currentStep: 'Hotovo',
        completedPages: total,
        errors: await errorsKeepingReclaimMarkers(jobId, errors),
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
  // Fronta dávek: dávka, na jejíž rezervaci nestačí volný kredit, se zmenší
  // a zbytek jejích stránek se vrátí na začátek fronty (BIL-1).
  const queue = [...batches];
  let batchNo = 0;

  /** Zastaví job pro nedostatek kreditu – nezpracované stránky vrátí do fronty. */
  const stopForCredit = async (
    pending: { pageId: string }[],
    required: number,
    available: number,
  ): Promise<void> => {
    await resetUnfinishedPages(pending.map((p) => p.pageId));
    errors.push(insufficientCreditMessage(required, available));
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: 'error',
        completedPages: completed,
        errors: await errorsKeepingReclaimMarkers(jobId, errors),
        currentStep: 'Nedostatečný kredit',
      },
    });
  };

  while (queue.length > 0) {
    let batch = queue.shift()!;
    batchNo++;

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
    const promptText = `${previousContext ?? ''}\n${userPrompt}`;
    const holdFor = (pageCount: number): number =>
      ocrBatchReservationCredits(pageCount, promptText, mode);

    // Dávka jen tak velká, na kolik stránek stačí volný kredit – rezervuje se
    // maximální cena (celý max_tokens), takže při nízkém zůstatku menší dávky.
    const { available } = await getCreditState(userId);
    const affordable = affordablePageCount(batch.length, available, holdFor);
    if (affordable === 0) {
      await stopForCredit([...batch, ...queue.flat()], holdFor(1), available);
      return;
    }
    if (affordable < batch.length) {
      queue.unshift(batch.slice(affordable));
      batch = batch.slice(0, affordable);
    }
    const totalBatches = batchNo + queue.length;

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        currentStep: `Zpracovávám dávku ${batchNo}/${totalBatches} (${batch.length} stránek)…`,
      },
    });

    // Obrázky dávky se načítají a připravují až teď, postupně a jen pro tuto dávku;
    // po skončení iterace je uvolní GC (PERF-1). Stránka, jejíž obrázek nejde načíst
    // nebo připravit, skončí chybou sama – nesmí shodit celou dávku ani zbytek jobu.
    const images: { buffer: Buffer; pageId: string; index: number }[] = [];
    const sentPages: (typeof batch)[number][] = [];
    for (const p of batch) {
      let original: Buffer;
      try {
        original = await loadImage(p.imageUrl);
      } catch (err) {
        // Chyba čtení nese serverovou cestu – do logu, uživateli obecná hláška
        console.error(
          `[Worker] Image of page ${p.pageId} cannot be read:`,
          err instanceof Error ? err.message : err,
        );
        errors.push(`Stránka ${p.pageId}: ${IMAGE_UNREADABLE_MESSAGE}`);
        await markPageFailed(p.pageId, p.existingDocId, IMAGE_UNREADABLE_MESSAGE);
        continue;
      }
      try {
        const { buffer } = await prepareImage(original);
        images.push({ buffer, pageId: p.pageId, index: sentPages.length });
        sentPages.push(p);
      } catch (err) {
        const message = `Obrázek nelze připravit pro OCR: ${err instanceof Error ? err.message : 'neznámá chyba'}`;
        console.error(`[Worker] Image preparation failed for page ${p.pageId}:`, message);
        errors.push(`Stránka ${p.pageId}: ${message}`);
        await markPageFailed(p.pageId, p.existingDocId, message);
      }
    }

    if (sentPages.length === 0) {
      completed += batch.length;
      await prisma.processingJob.update({
        where: { id: jobId },
        data: { completedPages: completed },
      });
      continue;
    }

    // Klíč odečtu je deterministický a odvozený od jobu a stránek dávky (BIL-3):
    // dřívější `batch-${jobId}-${batchIdx}` po reclaimu kolidoval – dávky se číslují
    // znovu od 0, nová dávka 0 (jiné stránky) tak „idempotentně" prošla bez
    // zaplacení. Opakované zpracování stejných stránek po restartu se naopak
    // neúčtuje dvakrát.
    const batchDescription = `OCR dávka ${batchNo} (${sentPages.length} stránek)${collectionLabel}`;
    const batchReferenceId = ocrBatchReferenceId(
      jobId,
      sentPages.map((p) => p.pageId),
    );

    // Rezervace maximální ceny dávky těsně před voláním API (BIL-1). Mezi odhadem
    // výše a rezervací mohl volný kredit spotřebovat souběžný job – pak stop.
    const reservation = await reserveCredits({
      userId,
      jobId,
      referenceId: batchReferenceId,
      description: batchDescription,
      amount: holdFor(sentPages.length),
    });
    if (!reservation.ok) {
      await stopForCredit(
        [...sentPages, ...queue.flat()],
        reservation.required,
        reservation.available,
      );
      return;
    }
    const hold = reservation.hold;

    // Call Claude with all images in the batch at once
    const estimatedTotal = avgOutputPerPage * sentPages.length;
    let lastProgressUpdate = 0;

    const processBatch = isCliMode() ? processWithClaudeBatchCli : processWithClaudeBatch;
    let batchResult: Awaited<ReturnType<typeof processWithClaudeBatch>>;
    try {
      batchResult = await processBatch(images, userPrompt, {
        previousContext,
        estimatedOutputTokens: estimatedTotal,
        mode,
        language,
        onProgress: (currentTokens, estimated) => {
          const now = Date.now();
          if (now - lastProgressUpdate < 2000) return;
          lastProgressUpdate = now;

          const pct = Math.min(99, Math.round((currentTokens / estimated) * 100));
          void prisma.processingJob
            .update({
              where: { id: jobId },
              data: {
                currentStep: `Dávka ${batchNo}/${totalBatches} — ${currentTokens.toLocaleString('cs')} / ~${estimated.toLocaleString('cs')} tokenů (${pct}%)`,
              },
            })
            .catch(() => {});
        },
      });
    } catch (err) {
      // Odmítnutí bezpečnostním filtrem (i po fallbacku) se týká jen této dávky –
      // stránky dostanou chybu, job pokračuje dalšími dávkami.
      if (!(err instanceof OcrRefusalError)) {
        // Volání selhalo bez známé spotřeby (síť, chyba API) – rezervaci uvolnit
        await releaseCreditHold(hold).catch((releaseErr: unknown) => {
          console.error(`[Worker] Release of hold ${hold.id} failed:`, releaseErr);
        });
        throw err;
      }
      console.warn(
        `[Worker] Batch ${batchNo} refused (${err.category ?? 'unknown'}):`,
        err.message,
      );
      // Vlastní klíč odmítnutí: po reclaimu může tatáž sada stránek projít –
      // se sdíleným klíčem by se úspěšné OCR „zaplatilo" cenou odmítnutí.
      const refusedReferenceId = ocrBatchRefusedReferenceId(
        jobId,
        sentPages.map((p) => p.pageId),
      );
      const refusedDescription = `OCR dávka ${batchNo} – odmítnuto modelem${collectionLabel}`;
      await settleCreditHold(
        hold,
        withCollection(firstPage.collectionId, [
          ...refusalCharges(err.usage, refusedReferenceId, refusedDescription),
          ...declinedAttemptCharges(err.declinedAttempts, refusedDescription, refusedReferenceId),
        ]),
      ).catch(async (billingErr: unknown) => {
        console.error(`[Worker] Billing of refused batch failed for job ${jobId}:`, billingErr);
        await releaseCreditHold(hold).catch(() => false);
      });
      for (const p of sentPages) {
        errors.push(`Stránka ${p.pageId}: ${err.message}`);
        await markPageFailed(p.pageId, p.existingDocId, err.message);
      }
      completed += batch.length;
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          completedPages: completed,
          errors: await errorsKeepingReclaimMarkers(jobId, errors),
        },
      });
      continue;
    }
    const {
      results,
      rawResponse,
      processingTimeMs,
      model,
      inputTokens,
      outputTokens,
      truncated,
      parseProblem,
      declinedAttempts,
    } = batchResult;

    // Vyúčtování hned po získání usage, ještě před ukládáním – pád workeru mezi
    // uložením a odečtem by jinak nechal zpracování nezaplacené. Pokusy, které
    // serverový fallback odmítl, top-level usage nepokrývá – účtují se zvlášť
    // (každý svým modelem a s klíčem odvozeným od klíče dávky) v téže rezervaci.
    // Chyba billingu (DB) nesmí zahodit výstup dávky, který už je zaplacený
    // Anthropicu: výsledky se uloží a další dávky se zastaví.
    let billingFailed = false;
    // Skutečný odečet za dávku (i s odmítnutými pokusy) se rozpočítá na stránky
    // a uloží k dokumentům (BIL-11); při selhání vyúčtování zůstane neznámý.
    let perPageCharged: number | null = null;
    try {
      const settle = await settleCreditHold(
        hold,
        withCollection(firstPage.collectionId, [
          {
            referenceId: batchReferenceId,
            description: batchDescription,
            model,
            inputTokens,
            outputTokens,
          },
          ...declinedAttemptCharges(declinedAttempts, batchDescription, batchReferenceId),
        ]),
      );
      perPageCharged = Math.round(settledCredits(settle) / sentPages.length);
    } catch (err) {
      console.error(`[Worker] Billing failed for job ${jobId}, batch ${batchNo}:`, err);
      billingFailed = true;
      await releaseCreditHold(hold).catch(() => false);
    }

    // Distribute tokens proportionally across pages in the batch
    const perPageInputTokens = Math.round(inputTokens / sentPages.length);
    const perPageOutputTokens = Math.round(outputTokens / sentPages.length);
    const perPageProcessingTimeMs = Math.round(processingTimeMs / sentPages.length);

    // Save results for each page
    const savedDocs: { pageId: string; docId: string }[] = [];
    for (const { index, result } of results) {
      const pageInfo = sentPages[index];
      if (!pageInfo) continue;

      try {
        const metadata = {
          model,
          inputTokens: perPageInputTokens,
          outputTokens: perPageOutputTokens,
          processingTimeMs: perPageProcessingTimeMs,
          chargedCredits: perPageCharged,
        };
        const doc =
          regenerate && pageInfo.existingDocId
            ? await regenerateDocumentResult(
                pageInfo.existingDocId,
                result,
                rawResponse,
                metadata,
                language,
                jobId,
              )
            : await saveDocumentResult(
                pageInfo.pageId,
                pageInfo.existingDocId ? { id: pageInfo.existingDocId } : null,
                pageInfo.imageHash,
                result,
                rawResponse,
                metadata,
                language,
              );

        savedDocs.push({ pageId: pageInfo.pageId, docId: doc.id });

        await setPageStatus(pageInfo.pageId, 'done');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        console.error(`[Worker] Save failed for page ${pageInfo.pageId}:`, message);
        errors.push(`Stránka ${pageInfo.pageId}: ${message}`);
        await markPageFailed(pageInfo.pageId, pageInfo.existingDocId, message);
      }
    }

    // Handle pages that didn't get a result. Při useknutí výstupu (stop_reason
    // max_tokens) se kompletní stránky uloží výše a zbytek skončí jasnou chybou –
    // neúplný výsledek se nikdy neukládá (LLM-2). Účtuje se skutečná spotřeba volání.
    const processedIndices = new Set(results.map((r) => r.index));
    for (let idx = 0; idx < sentPages.length; idx++) {
      if (!processedIndices.has(idx)) {
        const pageInfo = sentPages[idx]!;
        // parseProblem: výstup nešel jednoznačně přiřadit ke stránkám, takže se
        // raději neuložilo nic, než aby se přepis uložil k jiné stránce (LLM-3).
        const message =
          parseProblem ??
          (truncated
            ? 'Výstup modelu byl useknut (limit max_tokens) – stránka nebyla zpracována, spusťte zpracování znovu'
            : 'Model nevrátil výsledek pro tuto stránku');
        errors.push(`Stránka ${pageInfo.pageId}: ${message}`);
        await markPageFailed(pageInfo.pageId, pageInfo.existingDocId, message);
      }
    }

    // Update completed count
    completed += batch.length;

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        completedPages: completed,
        currentStep: `Dávka ${batchNo}/${totalBatches} hotova`,
      },
    });

    console.log(
      `[Worker] Batch ${batchNo}/${totalBatches} done: ${sentPages.length} pages in ${processingTimeMs}ms (${model}, ${inputTokens}+${outputTokens} tokens)`,
    );

    // Vyúčtování selhalo – další dávky nespouštět
    if (billingFailed) {
      await resetUnfinishedPages(queue.flat().map((p) => p.pageId));
      errors.push('Odečet kreditu selhal – výsledky dávky uloženy, zpracování zastaveno');
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: 'error',
          completedPages: completed,
          errors: await errorsKeepingReclaimMarkers(jobId, errors),
          currentStep: 'Odečet kreditu selhal',
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
      await resetUnfinishedPages(queue.flat().map((p) => p.pageId));
      return;
    }

    if (jobStatus === 'error') {
      return;
    }
  }

  // ── Complete job ─────────────────────────────────────
  // Surface collected per-page errors, and flag the job as failed when nothing
  // succeeded (previously it always reported 'completed', hiding total failures).
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: errors.length > 0 && errors.length >= total ? 'error' : 'completed',
      currentStep: 'Hotovo',
      completedPages: total,
      errors: await errorsKeepingReclaimMarkers(jobId, errors),
    },
  });
}

/**
 * Označí neúspěšné zpracování stránky. Stránka s existujícím dokumentem (typicky
 * nepovedená regenerace) zůstává `done` – její dokument je nedotčený – a chyba se
 * jen poznamená do `errorMessage`; stránka bez dokumentu přejde do `error`.
 */
async function markPageFailed(
  pageId: string,
  existingDocId: string | null,
  message: string,
): Promise<void> {
  await setPageStatus(pageId, existingDocId ? 'done' : 'error', message);
}

/**
 * Deterministický `referenceId` odečtu za OCR dávku: job + hash seřazených ID
 * stránek, které šly do API. Každá stránka je v jednom běhu jobu jen v jedné
 * dávce, takže různé dávky nekolidují; po restartu dostane stejná sada stránek
 * stejný klíč (idempotentní odečet) a jiná sada jiný.
 */
export function ocrBatchReferenceId(jobId: string, pageIds: string[]): string {
  return `ocr-batch:${jobId}:${pageSetDigest(pageIds)}`;
}

/**
 * `referenceId` odečtu za dávku odmítnutou bezpečnostním filtrem. Liší se od
 * `ocrBatchReferenceId`, aby po reclaimu úspěšné OCR téže sady stránek nenarazilo
 * na idempotentní klíč odmítnutí a neprošlo za cenu odmítnutého volání.
 */
export function ocrBatchRefusedReferenceId(jobId: string, pageIds: string[]): string {
  return `ocr-batch-refused:${jobId}:${pageSetDigest(pageIds)}`;
}

/** `referenceId` i-tého odmítnutého pokusu serverového fallbacku dávky. */
export function declinedAttemptReferenceId(batchReferenceId: string, index: number): string {
  return `${batchReferenceId}:declined:${index}`;
}

function pageSetDigest(pageIds: string[]): string {
  return crypto
    .createHash('sha256')
    .update([...pageIds].sort().join(','))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Kolik prvních stránek dávky se vejde do volného kreditu, když se rezervuje
 * maximální cena dávky (`holdFor`). 0 = nestačí ani na jednu stránku.
 */
export function affordablePageCount(
  pageCount: number,
  available: number,
  holdFor: (pageCount: number) => number,
): number {
  for (let n = pageCount; n >= 1; n--) {
    if (holdFor(n) <= available) return n;
  }
  return 0;
}

/** Položkám vyúčtování doplní svazek (cena svazku z ledgeru, BIL-11). */
function withCollection(collectionId: string | null, charges: CreditCharge[]): CreditCharge[] {
  return charges.map((c) => ({ ...c, collectionId }));
}

/** `referenceId` odečtu za deduplikovanou kopii – stránka + zdrojový dokument. */
export function dedupReferenceId(pageId: string, sourceDocumentId: string): string {
  return `dedup:${pageId}:${sourceDocumentId}`;
}

/**
 * Položka vyúčtování za odmítnutý pokus, pokud ho účtuje Anthropic
 * (`isRefusalBilled`): odmítnutí uprostřed výstupu vždy, odmítnutí před
 * výstupem jen v účtovaných kategoriích. Idempotenci drží `referenceId`.
 */
function refusalCharges(
  attempt: OcrAttemptUsage,
  referenceId: string,
  description: string,
): CreditCharge[] {
  if (!isRefusalBilled(attempt.outputTokens, attempt.category)) return [];
  if (attempt.inputTokens + attempt.outputTokens <= 0) return [];
  return [
    {
      referenceId,
      description,
      model: attempt.model,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
    },
  ];
}

/**
 * Položky za pokusy, které v řetězci serverového fallbacku odmítl předchozí
 * model (top-level usage je nepokrývá). Každý zvlášť, sazbou svého modelu
 * a s klíčem odvozeným od klíče dávky – opakované zpracování po restartu
 * neúčtuje dvakrát.
 */
function declinedAttemptCharges(
  attempts: OcrAttemptUsage[],
  description: string,
  batchReferenceId: string,
): CreditCharge[] {
  return attempts.flatMap((attempt, i) =>
    refusalCharges(
      attempt,
      declinedAttemptReferenceId(batchReferenceId, i),
      `${description} – odmítnutý pokus (${attempt.model})`,
    ),
  );
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
  collectionId: string | null,
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

  // Rezervace před voláním a vyúčtování hned po něm (BIL-1) – spotřeba vznikla,
  // i když se výsledek neuloží. Deterministický referenceId (bez Date.now()) –
  // opakovaný běh neúčtuje dvakrát. Bez volného kreditu se volání nespustí
  // (InsufficientCreditError skončí jako chyba stránky).
  const { response, billing } = await createBilledMessage(
    {
      userId,
      jobId,
      referenceId: `translate-doc-${jobId}-${doc.id}-${targetLanguage}`,
      description: `Překlad dokumentu ${doc.id}${collectionLabel}`,
      collectionId,
    },
    {
      model: TEXT_MODEL,
      maxTokens: LLM_MAX_TOKENS.translateDocument,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    },
  );

  // Useknutý (max_tokens) nebo odmítnutý výstup se neukládá – jinak by se jako
  // překlad uložil i surový neúplný JSON (`{"translation": "…`).
  if (response.stopReason !== 'end_turn') {
    throw new Error(
      `Model nevrátil kompletní překlad (${response.stopReason ?? 'neznámý důvod'}) – překlad se neuložil`,
    );
  }

  const text = response.text;

  let parsed: {
    translation: string;
    context: string;
    glossary: { term: string; definition: string }[];
  };
  try {
    // Strip optional ```json fences and isolate the JSON object before parsing,
    // so a fenced/decorated response doesn't get stored as the raw translation.
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonText = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    parsed = JSON.parse(jsonText);
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
      chargedCredits: chargedCreditsOf(billing),
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
      chargedCredits: chargedCreditsOf(billing),
    },
  });

  // Posunout Document.updatedAt – podle něj `ais push` detekuje, že se překlad
  // na serveru změnil (Translation vlastní updatedAt nemá).
  await prisma.document.update({
    where: { id: doc.id },
    data: { updatedAt: new Date() },
    select: { id: true },
  });
}
