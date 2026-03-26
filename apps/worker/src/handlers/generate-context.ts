/**
 * Worker handler for generating collection context from transcriptions.
 */

import { getAnthropicClient } from '../lib/anthropic';
import { prisma } from '@ai-sedlacek/db';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';

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
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

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
    const metadataResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
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

    const metadataText =
      metadataResponse.content[0]?.type === 'text' ? metadataResponse.content[0].text : '';

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

    // Deduct tokens for metadata call too
    await deductTokensIfSufficient(
      userId,
      metadataResponse.usage.input_tokens,
      metadataResponse.usage.output_tokens,
      `Metadata kontextu svazku ${collection.name}`,
      `generate-context-meta:${collectionId}:${Date.now()}`,
    ).catch((err) => {
      console.warn('[Worker:generate-context] Token deduction failed:', err);
    });
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

  // Deduct tokens for main context call
  await deductTokensIfSufficient(
    userId,
    response.usage.input_tokens,
    response.usage.output_tokens,
    `Generování kontextu svazku ${collection.name} z ${pagesWithDocs.length} stránek`,
    `generate-context:${collectionId}:${Date.now()}`,
  ).catch((err) => {
    console.warn('[Worker:generate-context] Token deduction failed:', err);
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
