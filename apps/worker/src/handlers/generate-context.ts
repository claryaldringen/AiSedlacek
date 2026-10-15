/**
 * Worker handler for generating collection context from transcriptions.
 */

import { createMessage } from '../lib/llm';
import { prisma } from '@ai-sedlacek/db';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';
import { TEXT_MODEL } from '@ai-sedlacek/shared';

export interface GenerateContextJobData {
  collectionId: string;
  pageIds: string[];
  userId: string;
}

export async function handleGenerateContext(
  jobId: string,
  data: GenerateContextJobData,
): Promise<void> {
  const { collectionId, pageIds, userId } = data;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Načítám svazek a stránky…' },
  });

  // Verify collection belongs to user
  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection || collection.userId !== userId) {
    throw new Error('Svazek nenalezen');
  }

  // Load pages with documents — only done pages with transcription
  const pagesWithDocs = await prisma.page.findMany({
    where: {
      id: { in: pageIds },
      collectionId,
      status: 'done',
      document: { isNot: null },
    },
    include: {
      document: {
        select: { transcription: true },
      },
    },
    orderBy: { order: 'asc' },
  });

  if (pagesWithDocs.length === 0) {
    throw new Error('Žádné zpracované stránky s transkripcí');
  }

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      currentStep: `Generuji kontext z ${pagesWithDocs.length} stránek…`,
      totalPages: 2, // 2 steps: context generation + metadata extraction
      completedPages: 0,
    },
  });

  // Concatenate transcriptions with page labels
  let concatenated = pagesWithDocs
    .map((page, idx) => {
      const label = page.displayName || page.filename;
      return `--- Stránka ${idx + 1}: ${label} ---\n${page.document?.transcription ?? ''}`;
    })
    .join('\n\n');

  // Truncate to ~100k characters if too long
  if (concatenated.length > 100_000) {
    concatenated = concatenated.slice(0, 100_000) + '\n\n[... text zkrácen ...]';
  }

  const prompt = `Jsi expert na historické rukopisy. Z následujících přepisů stránek starého textu vytvoř podrobný kontext díla v českém jazyce.

Extrahuj a strukturuj tyto informace (pokud jsou dostupné):
- Název díla
- Autor / původ
- Datace (přibližný rok nebo období vzniku)
- Jazyk textu
- Knihovna / úložiště a signatura
- Fyzický popis (počet listů, rozměry, materiál)
- Obsah a struktura díla
- Historický kontext
- Provenience (dějiny vlastnictví)

Výstup formátuj jako přehledný markdown s nadpisy a tabulkami.

Přepisy stránek:
${concatenated}`;

  // Call Claude Sonnet
  const response = await createMessage({
    model: TEXT_MODEL,
    // Kontext se ukládá jen kompletní (stopReason === 'end_turn') – limit musí
    // stačit i pro velké svazky, stejně jako fetch-context a translate-context.
    maxTokens: 16_000,
    messages: [{ role: 'user', content: prompt }],
  });

  const context = response.text;

  // Odečíst hned po volání (stejně jako OCR dávky) – ne až po zápisu do DB.
  await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Generování kontextu svazku ${collection.name} z ${pagesWithDocs.length} stránek`,
    // Deterministický klíč z jobu (BIL-3, dřív Date.now())
    `generate-context:${jobId}:${collectionId}`,
  ).catch((err) => {
    console.warn('[Worker:generate-context] Token deduction failed:', err);
  });

  // Kontext svazku nemá historii – přepsat ho smí jen kompletní, neprázdný
  // výstup (DAT-2, stejně jako fetch-context ve webu).
  if (response.stopReason !== 'end_turn' || context.trim() === '') {
    throw new Error('Model nevrátil kompletní kontext – kontext svazku zůstal beze změny');
  }

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      completedPages: 1,
      currentStep: 'Extrahuji metadata…',
    },
  });

  // Try to extract structured metadata with a second call
  let metadata: {
    title?: string;
    author?: string;
    yearFrom?: number;
    yearTo?: number;
    librarySignature?: string;
    abstract?: string;
  } | null = null;

  try {
    const metadataResponse = await createMessage({
      model: TEXT_MODEL,
      maxTokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Z následujícího kontextu historického díla extrahuj strukturovaná metadata. Vrať POUZE platný JSON objekt bez markdown backticks, bez dalšího textu.

Formát:
{
  "title": "název díla nebo null",
  "author": "autor nebo null",
  "yearFrom": číslo nebo null,
  "yearTo": číslo nebo null,
  "librarySignature": "signatura nebo null",
  "abstract": "stručný popis do 200 znaků nebo null"
}

Kontext:
${context}`,
        },
      ],
    });

    // Odečíst před parsováním – neplatný JSON jinak přeskočil odečet a volání
    // bylo zadarmo.
    await deductTokensIfSufficient(
      userId,
      metadataResponse.inputTokens,
      metadataResponse.outputTokens,
      `Metadata kontextu svazku ${collection.name}`,
      // Deterministický klíč z jobu (BIL-3, dřív Date.now())
      `generate-context-meta:${jobId}:${collectionId}`,
    ).catch((err) => {
      console.warn('[Worker:generate-context] Token deduction failed:', err);
    });

    // Model občas obalí JSON do ``` bloku i přes instrukci.
    const metadataText = metadataResponse.text
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    if (metadataText) {
      const parsed = JSON.parse(metadataText) as Record<string, unknown>;
      metadata = {
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        author: typeof parsed.author === 'string' ? parsed.author : undefined,
        yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : undefined,
        yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : undefined,
        librarySignature:
          typeof parsed.librarySignature === 'string' ? parsed.librarySignature : undefined,
        abstract: typeof parsed.abstract === 'string' ? parsed.abstract : undefined,
      };
    }
  } catch {
    // Metadata extraction is best-effort — ignore errors
  }

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Ukládám kontext…' },
  });

  // Save context and metadata to collection
  // Worker prompt is in Czech, so generated context is always in Czech
  const updateData: Record<string, unknown> = { context, contextLanguage: 'cs' };
  if (metadata) {
    if (metadata.title) updateData.title = metadata.title;
    if (metadata.author) updateData.author = metadata.author;
    if (metadata.yearFrom) updateData.yearFrom = metadata.yearFrom;
    if (metadata.yearTo) updateData.yearTo = metadata.yearTo;
    if (metadata.librarySignature) updateData.librarySignature = metadata.librarySignature;
    if (metadata.abstract) updateData.abstract = metadata.abstract;
  }

  await prisma.collection.update({
    where: { id: collectionId },
    data: updateData,
  });

  // Mark job as completed
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      currentStep: 'Hotovo',
      completedPages: 2,
    },
  });
}
