/**
 * Shared helper functions for OCR page processing.
 */

import crypto from 'crypto';
import { prisma } from '@ai-sedlacek/db';
import { createVersion } from '@ai-sedlacek/db/versioning';
import type { CreditTx } from '@ai-sedlacek/db/billing';
import type { StructuredOcrResult } from '@ai-sedlacek/ocr';
import { NON_DEDUP_MODELS } from '@ai-sedlacek/shared';
import { getStorage } from './storage';
import { truncateContext } from './batch-utils';

// ── getPreviousPageContext ────────────────────────────────────

export async function getPreviousPageContext(
  collectionId: string | null,
  currentPageId: string,
  limit: number = 3,
): Promise<string | undefined> {
  if (!collectionId) return undefined;

  // Only pages that come BEFORE the current one (lower order). Previously this
  // returned the collection's last pages regardless of position, feeding the OCR
  // the wrong neighbouring context (and wasting tokens).
  const current = await prisma.page.findUnique({
    where: { id: currentPageId },
    select: { order: true },
  });
  if (current?.order == null) return undefined;

  const previousPages = await prisma.page.findMany({
    where: {
      collectionId,
      document: { isNot: null },
      id: { not: currentPageId },
      order: { lt: current.order },
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

/** Metadata zpracování ukládaná k dokumentu. */
export interface DocumentMetadata {
  model: string;
  inputTokens: number;
  outputTokens: number;
  processingTimeMs: number;
  /** Kredity skutečně odečtené za výsledek (BIL-11); null = odečet neznámý. */
  chargedCredits?: number | null;
}

export async function saveDocumentResult(
  pageId: string,
  existingDoc: { id: string } | null,
  hash: string,
  result: StructuredOcrResult,
  rawResponseLine: string,
  metadata: DocumentMetadata,
  targetLang: string,
  batchId?: string,
): Promise<{ id: string }> {
  if (existingDoc !== null) {
    await prisma.translation.create({
      data: {
        documentId: existingDoc.id,
        language: result.translationLanguage || targetLang,
        text: result.translation,
        // Dokument už existoval – celé OCR volání zaplatil tento překlad
        ...(metadata.chargedCredits != null ? { chargedCredits: metadata.chargedCredits } : {}),
      },
    });
    // Posunout Document.updatedAt – podle něj `ais push` detekuje, že se překlad
    // na serveru změnil (Translation vlastní updatedAt nemá).
    await prisma.document.update({
      where: { id: existingDoc.id },
      data: { updatedAt: new Date() },
      select: { id: true },
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
      chargedCredits: metadata.chargedCredits ?? null,
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

// ── regenerateDocumentResult ──────────────────────────────────

const REGENERATE_MAX_ATTEMPTS = 3;

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'P2002'
  );
}

/**
 * Zapíše výsledek regenerace do EXISTUJÍCÍHO dokumentu (DAT-1) – dokument se nikdy
 * nemaže ani nevytváří znovu, takže zůstane historie verzí i překlady.
 *
 * V jedné transakci:
 *  - předchozí hodnoty `transcription`, `context` a `translation:<jazyk>` (jen pole,
 *    která se mění) uloží jako verze se zdrojem `ai_regenerate` a novým modelem,
 *  - přepíše přepis, jazyk, kontext, rawResponse, model, tokeny a čas zpracování
 *    a nastaví `batchId = jobId` (značka, že tento job stránku už přegeneroval),
 *  - nahradí glosář,
 *  - upsertne překlad v jazyce výsledku; jeho per-jazykový `context`/`glossaryJson`
 *    vynuluje, aby se zobrazil nový kontext a glosář dokumentu.
 * Překlady v ostatních jazycích zůstávají beze změny.
 *
 * Číslo verze se alokuje uvnitř transakce; při kolizi se souběžným zápisem verze
 * (P2002) se celá transakce zopakuje.
 */
export async function regenerateDocumentResult(
  documentId: string,
  result: StructuredOcrResult,
  rawResponse: string,
  metadata: DocumentMetadata,
  targetLang: string,
  jobId: string,
): Promise<{ id: string }> {
  const language = result.translationLanguage || targetLang;

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.document.findUniqueOrThrow({
          where: { id: documentId },
          include: { translations: { select: { language: true, text: true } } },
        });

        const previous: { field: string; content: string }[] = [];
        if (current.transcription !== result.transcription) {
          previous.push({ field: 'transcription', content: current.transcription });
        }
        if (current.context !== result.context) {
          previous.push({ field: 'context', content: current.context });
        }
        const currentTranslation = current.translations.find((t) => t.language === language);
        if (currentTranslation && currentTranslation.text !== result.translation) {
          previous.push({ field: `translation:${language}`, content: currentTranslation.text });
        }

        if (previous.length > 0) {
          const last = await tx.documentVersion.findFirst({
            where: { documentId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          const firstVersion = (last?.version ?? 0) + 1;
          await tx.documentVersion.createMany({
            data: previous.map((v, i) => ({
              documentId,
              version: firstVersion + i,
              field: v.field,
              content: v.content,
              source: 'ai_regenerate',
              model: metadata.model,
            })),
          });
        }

        await tx.glossaryEntry.deleteMany({ where: { documentId } });
        await tx.document.update({
          where: { id: documentId },
          data: {
            transcription: result.transcription,
            detectedLanguage: result.detectedLanguage,
            context: result.context,
            rawResponse,
            model: metadata.model,
            inputTokens: metadata.inputTokens,
            outputTokens: metadata.outputTokens,
            processingTimeMs: metadata.processingTimeMs,
            // Cena aktuálního výsledku – předchozí zpracování zůstává v ledgeru svazku
            chargedCredits: metadata.chargedCredits ?? null,
            batchId: jobId,
            glossary: {
              create: result.glossary.map((g) => ({ term: g.term, definition: g.definition })),
            },
          },
        });

        await tx.translation.upsert({
          where: { documentId_language: { documentId, language } },
          update: {
            text: result.translation,
            model: metadata.model,
            inputTokens: null,
            outputTokens: null,
            // Překlad je teď součástí OCR (cena v Document.chargedCredits) – odečet
            // dřívější retranslace by se u něj jinak dál zobrazoval (BIL-11)
            chargedCredits: null,
            context: null,
            glossaryJson: null,
          },
          create: {
            documentId,
            language,
            text: result.translation,
            model: metadata.model,
          },
        });

        return { id: documentId };
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < REGENERATE_MAX_ATTEMPTS) continue;
      throw e;
    }
  }
}

// ── findDedupSourceDocument ───────────────────────────────────

/** Zdrojový dokument pro deduplikaci (dokument + překlady + glosář). */
export interface DedupSourceDocument {
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
}

/** Viz `NON_DEDUP_MODELS` v packages/shared (sdílí ho předběžná kontrola kreditu v API). */
export { NON_DEDUP_MODELS };

/**
 * Najde dokument se stejným hashem obrázku, který lze zkopírovat místo nového OCR.
 *
 * SEC-2 (hotfix): dříve se hledalo napříč všemi uživateli, takže se cizí ručně
 * upravené přepisy (a přes `rawResponse` i obsah dalších stránek cizí dávky)
 * kopírovaly jinému uživateli a přes `ais submit` šlo cizím uživatelům podstrčit
 * libovolný „AI výsledek". Nově jen:
 *  - dokumenty stránek TÉHOŽ uživatele, které nejsou archivované,
 *  - výstupy skutečného API volání workeru (`outputTokens > 0` – `/result` nechává
 *    tokeny prázdné, CLI režim zapisuje 0; model z `/result` si volí klient, proto
 *    samotný filtr na model nestačí).
 */
export async function findDedupSourceDocument(
  userId: string,
  hash: string,
): Promise<DedupSourceDocument | null> {
  return prisma.document.findFirst({
    where: {
      hash,
      page: { userId, status: { not: 'archived' } },
      model: { notIn: [...NON_DEDUP_MODELS] },
      outputTokens: { gt: 0 },
    },
    orderBy: { createdAt: 'desc' },
    include: { translations: true, glossary: true },
  });
}

// ── copyDocumentForPage ───────────────────────────────────────

/**
 * Copy an existing Document of the SAME user for a new page, including translations,
 * glossary, and versions. Source must come from `findDedupSourceDocument` (SEC-2).
 *
 * Běží v transakci `tx` – volající (deduplikace ve workeru) ji sdílí s odečtem
 * kreditu, takže když kopie selže, odečet se vrátí a uživatel nezaplatí za nic.
 * Nový dokument nemá žádné verze, proto se čísla verzí přidělují přímo (1…n).
 */
export async function copyDocumentForPage(
  tx: CreditTx,
  pageId: string,
  source: DedupSourceDocument,
  /** Kredity odečtené za kopii (cena původního OCR); null = neúčtováno. */
  chargedCredits: number | null = null,
): Promise<{ id: string }> {
  const doc = await tx.document.create({
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
      chargedCredits,
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
          // Kopie překladu se neúčtuje – cena kopie je jen cena původního OCR
          chargedCredits: t.inputTokens || t.outputTokens ? 0 : null,
        })),
      },
    },
    select: { id: true },
  });

  // Počáteční verze (transkripce, překlady, kontext)
  const model = source.model ?? undefined;
  const initial = [
    { field: 'transcription', content: source.transcription },
    ...source.translations.map((t) => ({ field: `translation:${t.language}`, content: t.text })),
    { field: 'context', content: source.context },
  ];
  await tx.documentVersion.createMany({
    data: initial.map((v, i) => ({
      documentId: doc.id,
      version: i + 1,
      field: v.field,
      content: v.content,
      source: 'ai_initial',
      model,
    })),
  });

  return doc;
}

// ── loadImage / hashImage ─────────────────────────────────────

function storagePathFromImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('/api/images/')) return imageUrl.replace('/api/images/', '');
  if (imageUrl.startsWith('/uploads/')) return imageUrl.replace('/uploads/', '');
  return imageUrl;
}

/** Načte originál obrázku stránky z úložiště. */
export async function loadImage(imageUrl: string): Promise<Buffer> {
  return getStorage().read(storagePathFromImageUrl(imageUrl));
}

/**
 * Spočítá SHA256 hash a velikost obrázku. Buffer se hned zahodí – ve fázi přípravy
 * jobu se obrázky nesmí držet v paměti (PERF-1: celý svazek jako base64 → OOM,
 * restart PM2 a nekonečná smyčka reclaimu). Obrázek se znovu načte až pro dávku.
 */
export async function hashImage(
  imageUrl: string,
): Promise<{ imageHash: string; fileSize: number }> {
  const imageBuffer = await loadImage(imageUrl);
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  return { imageHash, fileSize: imageBuffer.length };
}
