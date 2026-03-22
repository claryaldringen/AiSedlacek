/**
 * Shared helper functions for OCR page processing.
 * Used by both the API route (POST /api/pages/process) and the Inngest function.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import type { StructuredOcrResult } from '@/lib/adapters/ocr/claude-vision';
import { createVersion } from '@/lib/infrastructure/versioning';
import { getStorage } from '@/lib/adapters/storage';
import { truncateContext } from '@/lib/batch-utils';

// ── getPreviousPageContext ────────────────────────────────────

export async function getPreviousPageContext(
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

// ── saveDocumentResult ────────────────────────────────────────

export async function saveDocumentResult(
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

// ── copyDocumentForPage ───────────────────────────────────────

/** Copy an existing Document (from any user) for a new page, including translations, glossary, and versions. */
export async function copyDocumentForPage(
  pageId: string,
  source: {
    id: string;
    hash: string;
    rawResponse: string | null;
    transcription: string;
    detectedLanguage: string;
    context: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    processingTimeMs: number | null;
    batchId?: string | null;
    translations: {
      language: string;
      text: string;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }[];
    glossary: { term: string; definition: string }[];
  },
): Promise<{ id: string }> {
  const doc = await prisma.document.create({
    data: {
      pageId,
      hash: source.hash,
      rawResponse: source.rawResponse,
      transcription: source.transcription,
      detectedLanguage: source.detectedLanguage,
      context: source.context,
      model: source.model,
      inputTokens: source.inputTokens,
      outputTokens: source.outputTokens,
      processingTimeMs: source.processingTimeMs,
      glossary: {
        create: source.glossary.map((g) => ({
          term: g.term,
          definition: g.definition,
        })),
      },
      translations: {
        create: source.translations.map((t) => ({
          language: t.language,
          text: t.text,
          model: t.model,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
        })),
      },
    },
  });

  // Create initial version records
  await createVersion(
    doc.id,
    'transcription',
    source.transcription,
    'ai_initial',
    source.model ?? undefined,
  );
  for (const t of source.translations) {
    await createVersion(
      doc.id,
      `translation:${t.language}`,
      t.text,
      'ai_initial',
      source.model ?? undefined,
    );
  }
  await createVersion(doc.id, 'context', source.context, 'ai_initial', source.model ?? undefined);

  return doc;
}

// ── loadImageAndHash ──────────────────────────────────────────

export async function loadImageAndHash(
  imageUrl: string,
): Promise<{ imageBuffer: Buffer; imageHash: string }> {
  const storage = getStorage();
  const storagePath = imageUrl.startsWith('/api/images/')
    ? imageUrl.replace('/api/images/', '')
    : imageUrl;
  const imageBuffer = await storage.read(storagePath);
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  return { imageBuffer, imageHash };
}
