import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocky ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  prisma: {
    collection: { findUnique: vi.fn() },
    page: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    document: { aggregate: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    documentVersion: { createMany: vi.fn() },
    translation: { create: vi.fn(), upsert: vi.fn() },
    processingJob: { update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  // Klient uvnitř prisma.$transaction (regenerace, DAT-1)
  tx: {
    document: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    documentVersion: { findFirst: vi.fn(), createMany: vi.fn() },
    glossaryEntry: { deleteMany: vi.fn() },
    translation: { upsert: vi.fn() },
  },
  createVersion: vi.fn(),
  processWithClaudeBatch: vi.fn(),
  prepareImage: vi.fn(),
  storageRead: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', async () => (await import('./billing-mock')).billingModule());
vi.mock('@ai-sedlacek/db/versioning', () => ({ createVersion: mocks.createVersion }));
vi.mock('@ai-sedlacek/ocr', async (importOriginal) => ({
  OcrRefusalError: (await importOriginal<typeof import('@ai-sedlacek/ocr')>()).OcrRefusalError,
  ocrBatchReservationCredits: (await importOriginal<typeof import('@ai-sedlacek/ocr')>())
    .ocrBatchReservationCredits,
  prepareImage: mocks.prepareImage,
  processWithClaudeBatch: mocks.processWithClaudeBatch,
  processWithClaudeBatchCli: vi.fn(),
}));
vi.mock('../lib/storage', () => ({ getStorage: () => ({ read: mocks.storageRead }) }));
vi.mock('../lib/llm', () => ({ isCliMode: () => false, createMessage: mocks.createMessage }));

import {
  processPages,
  ocrBatchReferenceId,
  ocrBatchRefusedReferenceId,
  ocrBatchInterruptedReferenceId,
  IMAGE_UNREADABLE_MESSAGE,
  IMAGE_PREPARE_FAILED_MESSAGE,
  BATCH_INTERRUPTED_MESSAGE,
  JOB_STOPPED_INTERRUPTED_MESSAGE,
  INSUFFICIENT_CREDIT_PAGE_MESSAGE,
  COPY_FAILED_MESSAGE,
  RESULT_SAVE_FAILED_MESSAGE,
  TRANSLATION_FAILED_MESSAGE,
} from '../handlers/process-pages';
import { OcrRefusalError } from '@ai-sedlacek/ocr';
import { RECLAIM_MARKER } from '../lib/reclaim';
import { JobError } from '../lib/job-error';
import {
  billing,
  blockReservationsByOtherHolds,
  charges,
  consumeTx,
  refuseReservations,
  resetBillingMock,
} from './billing-mock';

/** Vyúčtované položky jako [vstup, výstup, referenceId, model]. */
function chargeRows(): unknown[][] {
  return charges().map((c) => [c.inputTokens, c.outputTokens, c.referenceId, c.model]);
}

// ── Fixtures ─────────────────────────────────────────────────
interface PageFixture {
  id: string;
  userId: string;
  order: number;
  status: string;
  imageUrl: string;
  collection: { id: string; context: string } | null;
  document: null | {
    id: string;
    batchId?: string | null;
    context: string;
    translations: { language: string; text: string }[];
    glossary: { term: string; definition: string }[];
  };
}

const pages = new Map<string, PageFixture>();

function addPage(id: string, overrides: Partial<PageFixture> = {}): PageFixture {
  const page: PageFixture = {
    id,
    userId: 'user-1',
    order: pages.size,
    status: 'pending',
    imageUrl: `/uploads/${id}.jpg`,
    collection: null,
    document: null,
    ...overrides,
  };
  pages.set(id, page);
  return page;
}

function ocrResult(n: number) {
  return {
    transcription: `přepis ${n}`,
    detectedLanguage: 'la',
    translation: `překlad ${n}`,
    translationLanguage: 'cs',
    context: `kontext ${n}`,
    glossary: [],
  };
}

const baseJob = {
  jobId: 'job-1',
  userId: 'user-1',
  language: 'cs',
  mode: 'transcribe+translate' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  pages.clear();

  mocks.prisma.page.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    return pages.get(where.id) ?? null;
  });
  mocks.prisma.page.findMany.mockImplementation(
    async ({ where }: { where: { id: { in?: string[] } } }) =>
      // Kontext předchozích stránek svazku (getPreviousPageContext) v testech prázdný
      (where.id.in ?? [])
        .filter((id) => pages.has(id))
        .map((id) => ({ id, order: pages.get(id)!.order })),
  );
  mocks.prisma.page.update.mockResolvedValue({});
  mocks.prisma.page.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 2000 } });
  mocks.prisma.document.findFirst.mockResolvedValue(null);
  let docCounter = 0;
  mocks.prisma.document.create.mockImplementation(async () => ({ id: `doc-${++docCounter}` }));
  mocks.prisma.document.update.mockResolvedValue({});
  mocks.prisma.translation.create.mockResolvedValue({});
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.processingJob.findUnique.mockResolvedValue({ status: 'running' });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) =>
    fn(mocks.tx),
  );
  mocks.tx.document.update.mockResolvedValue({});
  mocks.tx.documentVersion.findFirst.mockResolvedValue({ version: 4 });
  mocks.tx.documentVersion.createMany.mockResolvedValue({ count: 0 });
  mocks.tx.glossaryEntry.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.translation.upsert.mockResolvedValue({});

  resetBillingMock();
  // Kopie dokumentu (deduplikace) běží v transakci odečtu – v testu nad mockem Prismy
  consumeTx.current = mocks.prisma;
  mocks.prisma.documentVersion.createMany.mockResolvedValue({ count: 0 });
  mocks.createVersion.mockResolvedValue(undefined);
  // Každá stránka má jiný obsah → jiný hash
  mocks.storageRead.mockImplementation(async (path: string) => Buffer.from(`image:${path}`));
  mocks.prepareImage.mockImplementation(async (buffer: Buffer) => ({
    buffer,
    mediaType: 'image/jpeg',
  }));
  mocks.processWithClaudeBatch.mockImplementation(async (images: { index: number }[]) => ({
    results: images.map((img) => ({ index: img.index, result: ocrResult(img.index) })),
    rawResponse: '{}',
    processingTimeMs: 1000,
    model: 'claude-opus-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    stopReason: 'end_turn',
    declinedAttempts: [],
  }));
});

// ── SEC-2 ────────────────────────────────────────────────────
describe('processPages – deduplikace (SEC-2)', () => {
  it('hledá zdroj deduplikace jen mezi nearchivovanými dokumenty téhož uživatele z API', async () => {
    addPage('p1');

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.document.findFirst).toHaveBeenCalledTimes(1);
    const where = mocks.prisma.document.findFirst.mock.calls[0]![0].where;
    expect(where.page).toEqual({ userId: 'user-1', status: { not: 'archived' } });
    // Výsledky z `ais submit` / CLI režimu se nikdy nekopírují
    expect(where.model).toEqual({ notIn: ['claude-cli', 'claude-agent-cli'] });
    expect(where.outputTokens).toEqual({ gt: 0 });
  });

  it('bez nalezeného zdroje deduplikace stránku zpracuje OCR a založí nový dokument', async () => {
    // Že se cizí dokumenty vůbec nehledají, ověřuje `where` v předchozím testu –
    // tady `findFirst` vrací null bez ohledu na dotaz.
    addPage('p1');

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create.mock.calls[0]![0].data.pageId).toBe('p1');
  });

  it('dokument téhož uživatele se zkopíruje místo nového OCR', async () => {
    addPage('p1');
    mocks.prisma.document.findFirst.mockResolvedValue({
      id: 'own-doc',
      hash: 'h',
      rawResponse: null,
      transcription: 'můj přepis',
      detectedLanguage: 'la',
      context: 'kontext',
      model: 'claude-opus-4-6',
      inputTokens: 100,
      outputTokens: 50,
      processingTimeMs: 10,
      translations: [
        { language: 'cs', text: 'překlad', model: null, inputTokens: null, outputTokens: null },
      ],
      glossary: [],
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create.mock.calls[0]![0].data.transcription).toBe('můj přepis');
    // Kopie se účtuje cenou původního zpracování – před kopií, jen z volného kreditu
    expect(chargeRows()).toEqual([[100, 50, 'dedup:p1:own-doc', 'claude-opus-4-6']]);
    const chargeOrder = billing.consumeCredits.mock.invocationCallOrder[0]!;
    const copyOrder = mocks.prisma.document.create.mock.invocationCallOrder[0]!;
    expect(chargeOrder).toBeLessThan(copyOrder);
  });

  it('bez volného kreditu kopii neudělá a stránku vrátí do fronty (BIL-1)', async () => {
    addPage('p1');
    mocks.prisma.document.findFirst.mockResolvedValue({
      id: 'own-doc',
      hash: 'h',
      model: 'claude-opus-4-6',
      inputTokens: 100,
      outputTokens: 50,
      translations: [],
      glossary: [],
    });
    refuseReservations(10, 5000);

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    // U stránky obecná hláška bez částek – vidí ji i členové sdíleného workspace
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'pending', errorMessage: INSUFFICIENT_CREDIT_PAGE_MESSAGE },
    });
    expect(INSUFFICIENT_CREDIT_PAGE_MESSAGE).not.toMatch(/\d/);
    // Částky jen do errors jobu (vidí ho jen vlastník) a kód pro lokalizovanou hlášku
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.errors).toEqual([
      expect.stringMatching(/Stránka p1: .*rezervovat 5\s000 tokenů, volných je 10/),
    ]);
    expect(lastJobUpdate.data.errorCode).toBe('insufficient_credit');
  });

  it('nepovedená kopie selže jen u své stránky a odečet se s ní vrátí', async () => {
    addPage('p1');
    addPage('p2');
    mocks.prisma.document.findFirst
      .mockResolvedValueOnce({
        id: 'own-doc',
        hash: 'h',
        rawResponse: null,
        transcription: 't',
        detectedLanguage: 'la',
        context: 'k',
        model: 'claude-opus-4-6',
        inputTokens: 100,
        outputTokens: 50,
        processingTimeMs: 10,
        translations: [],
        glossary: [],
      })
      .mockResolvedValue(null);
    // Zápis kopie selže (v ostrém běhu se tím vrátí i odečet ve stejné transakci)
    mocks.prisma.document.create.mockRejectedValueOnce(new Error('unique constraint'));

    await expect(processPages({ ...baseJob, pageIds: ['p1', 'p2'] })).resolves.toBeUndefined();

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: COPY_FAILED_MESSAGE },
    });
    // Odečet a kopie jdou jedním voláním (jedna transakce)
    expect(billing.consumeCredits).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ referenceId: 'dedup:p1:own-doc' }),
      expect.any(Function),
    );
    // Druhá stránka se normálně zpracuje OCR
    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
  });
});

// ── PERF-1 ───────────────────────────────────────────────────
describe('processPages – obrázky až pro konkrétní dávku (PERF-1)', () => {
  it('v přípravě obrázky jen hashuje a pro OCR je načte až těsně před svou dávkou', async () => {
    // Průměr 8000 tokenů/stránku → createBatches dá max. 2 stránky na dávku
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    addPage('p1');
    addPage('p2');
    addPage('p3');

    const log: string[] = [];
    mocks.storageRead.mockImplementation(async (path: string) => {
      log.push(`read:${path}`);
      return Buffer.from(`image:${path}`);
    });
    const ocrDefault = mocks.processWithClaudeBatch.getMockImplementation()!;
    mocks.processWithClaudeBatch.mockImplementation(
      async (images: { pageId: string; index: number }[], ...rest: unknown[]) => {
        log.push(`ocr:${images.map((i) => i.pageId).join(',')}`);
        return ocrDefault(images, ...rest);
      },
    );

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    expect(log).toEqual([
      // příprava: jen hash, nic se nedrží
      'read:p1.jpg',
      'read:p2.jpg',
      'read:p3.jpg',
      // dávka 1
      'read:p1.jpg',
      'read:p2.jpg',
      'ocr:p1,p2',
      // dávka 2 – její obrázky se načtou až po dokončení dávky 1
      'read:p3.jpg',
      'ocr:p3',
    ]);
  });

  it('stránka, jejíž obrázek nejde připravit, skončí chybou a zbytek dávky se uloží ke správným stránkám', async () => {
    addPage('p1');
    addPage('p2');
    addPage('p3');
    mocks.prepareImage.mockImplementation(async (buffer: Buffer) => {
      if (buffer.toString().includes('p2')) throw new Error('Input image exceeds pixel limit');
      return { buffer, mediaType: 'image/jpeg' };
    });

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    // Do API jdou jen p1 a p3, s indexy 0 a 1
    const images = mocks.processWithClaudeBatch.mock.calls[0]![0] as {
      pageId: string;
      index: number;
    }[];
    expect(images.map((i) => [i.pageId, i.index])).toEqual([
      ['p1', 0],
      ['p3', 1],
    ]);
    // p2 → chyba s pevnou hláškou; surová chyba Sharpu jen do logu (hlášku
    // stránky vidí i členové workspace)
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: IMAGE_PREPARE_FAILED_MESSAGE },
    });
    const pageMessages = mocks.prisma.page.updateMany.mock.calls.map(
      (c) => (c[0] as { data: { errorMessage?: string | null } }).data.errorMessage ?? '',
    );
    expect(pageMessages.join('\n')).not.toContain('pixel limit');
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.errors).toEqual([`Stránka p2: ${IMAGE_PREPARE_FAILED_MESSAGE}`]);
    // Výsledek indexu 1 patří p3, ne p2
    const created = mocks.prisma.document.create.mock.calls.map(
      (c) => [c[0].data.pageId, c[0].data.transcription] as const,
    );
    expect(created).toEqual([
      ['p1', 'přepis 0'],
      ['p3', 'přepis 1'],
    ]);
  });
});

// ── LLM-2 ────────────────────────────────────────────────────
describe('processPages – useknutý výstup dávky (LLM-2)', () => {
  it('kompletní stránky uloží, useknuté označí chybou a účtuje skutečnou spotřebu', async () => {
    addPage('p1');
    addPage('p2');
    mocks.processWithClaudeBatch.mockResolvedValue({
      results: [{ index: 0, result: ocrResult(0) }],
      rawResponse: '{...}',
      processingTimeMs: 1000,
      model: 'claude-opus-4-6',
      inputTokens: 3000,
      outputTokens: 48000,
      stopReason: 'max_tokens',
      declinedAttempts: [],
      truncated: true,
    });

    await processPages({ ...baseJob, pageIds: ['p1', 'p2'] });

    // p1 je kompletní → uložena
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create.mock.calls[0]![0].data.pageId).toBe('p1');
    // p2 → chyba s jasnou hláškou, nic se neuložilo
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: expect.stringContaining('useknut') },
    });
    // Účtuje se celé volání (skutečná spotřeba API), ne odhad
    expect(chargeRows()).toEqual([
      [3000, 48000, ocrBatchReferenceId('job-1', ['p1', 'p2']), 'claude-opus-4-6'],
    ]);
  });
});

// ── R-9 (review větve) ───────────────────────────────────────
describe('processPages – selhání billingu po volání API (R-9)', () => {
  it('výsledky už zaplacené dávky uloží a další dávky zastaví', async () => {
    // Průměr 8000 tokenů/stránku → max. 2 stránky na dávku: [p1, p2], [p3]
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    addPage('p1');
    addPage('p2');
    addPage('p3');
    billing.settleCreditHold.mockRejectedValue(new Error('DB connection lost'));

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    // Jen první dávka šla do API – její výstup je zaplacený, proto se uloží.
    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
    const savedPageIds = mocks.prisma.document.create.mock.calls.map((c) => c[0].data.pageId);
    expect(savedPageIds).toEqual(['p1', 'p2']);
    // Rezervace dávky se po selhání vyúčtování uvolní (neblokuje kredit)
    expect(billing.releaseCreditHold).toHaveBeenCalledTimes(1);
    // Druhá dávka se nespustí – její stránka se vrátí z `processing` do výchozího stavu.
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p3'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
    // Job skončí chybou s pravdivým důvodem (ne „Nedostatečný kredit", S2-9).
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      currentStep: 'Odečet kreditu selhal',
      errors: expect.arrayContaining([expect.stringContaining('Odečet kreditu selhal')]),
    });
  });
});

// ── R-22 (review větve) ──────────────────────────────────────
describe('processPages – archivovaná stránka (R-22)', () => {
  it('archivovanou stránku nezpracuje', async () => {
    addPage('p1', { status: 'archived' });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'p1' }) }),
    );
  });
});

// ── S2-6: archivace během zpracování ─────────────────────────
describe('processPages – archivace během zpracování', () => {
  it('zápis stavu stránky se podmíní tím, že není archivovaná', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockResolvedValue({
      results: [{ index: 0, result: ocrResult(0) }],
      rawResponse: '{...}',
      processingTimeMs: 1000,
      model: 'claude-opus-4-6',
      inputTokens: 3000,
      outputTokens: 2000,
      stopReason: 'end_turn',
      declinedAttempts: [],
      truncated: false,
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    // Žádný nepodmíněný zápis stavu – archivace během dávky má přednost.
    expect(mocks.prisma.page.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: expect.any(String) }) }),
    );
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
  });
});

// ── S2-11 ────────────────────────────────────────────────────
describe('processPages – překlad k existujícímu dokumentu (S2-11)', () => {
  it('dokument bez překladu dostane nový překlad a posunuté updatedAt', async () => {
    // Legacy dokument bez jakéhokoli překladu → OCR a jen nový překlad, dokument zůstane.
    addPage('p1', {
      document: { id: 'legacy-doc', context: 'kontext', translations: [], glossary: [] },
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    expect(mocks.prisma.translation.create).toHaveBeenCalledWith({
      // Celé OCR volání zaplatil nový překlad: Opus 4.6 1000 × $5 + 500 × $25 → 16 100 kreditů
      data: { documentId: 'legacy-doc', language: 'cs', text: 'překlad 0', chargedCredits: 16_100 },
    });
    // Token detekce konfliktů pro `ais push` (Translation vlastní updatedAt nemá).
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'legacy-doc' },
      data: { updatedAt: expect.any(Date) },
      select: { id: true },
    });
    const createOrder = mocks.prisma.translation.create.mock.invocationCallOrder[0]!;
    const bumpOrder = mocks.prisma.document.update.mock.invocationCallOrder[0]!;
    expect(createOrder).toBeLessThan(bumpOrder);
  });
});

// ── Opus 5.5: odmítnutí bezpečnostním filtrem ───────────────
describe('processPages – odmítnutá dávka', () => {
  it('stránky dávky označí chybou, naúčtuje spotřebu a job nespadne', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockRejectedValue(
      new OcrRefusalError('bio', {
        model: 'claude-opus-5-5',
        inputTokens: 3000,
        outputTokens: 40,
        category: 'bio',
      }),
    );

    await expect(processPages({ ...baseJob, pageIds: ['p1'] })).resolves.not.toThrow();

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: expect.stringContaining('odmítl') },
    });
    // Volání už proběhlo – spotřeba odmítnutí se vyúčtuje z rezervace dávky
    expect(chargeRows()).toEqual([
      [3000, 40, ocrBatchRefusedReferenceId('job-1', ['p1']), 'claude-opus-5-5'],
    ]);
    expect(charges()[0]!.description).toContain('odmítnuto');
  });
});

// ── LLM-3 ────────────────────────────────────────────────────
describe('processPages – nejednoznačné přiřazení výsledků dávky (LLM-3)', () => {
  it('nic neuloží a stránky označí chybou s důvodem z parseru', async () => {
    addPage('p1');
    addPage('p2');
    const problem =
      'Model vrátil duplicitní imageIndex (0, 0) – výsledky nelze jednoznačně přiřadit ke stránkám';
    mocks.processWithClaudeBatch.mockResolvedValue({
      results: [],
      rawResponse: '...',
      processingTimeMs: 1000,
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      stopReason: 'end_turn',
      declinedAttempts: [],
      truncated: false,
      parseProblem: problem,
    });

    await processPages({ ...baseJob, pageIds: ['p1', 'p2'] });

    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    for (const id of ['p1', 'p2']) {
      expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
        where: { id, status: { not: 'archived' } },
        data: { status: 'error', errorMessage: problem },
      });
    }
  });
});

// ── BIL-3 ────────────────────────────────────────────────────
describe('processPages – deterministický referenceId odečtu dávky (BIL-3)', () => {
  it('po reclaimu nová dávka s jinými stránkami nekoliduje s klíčem staré dávky', async () => {
    // Max. 2 stránky na dávku → [p1, p2], [p3]
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    addPage('p1');
    addPage('p2');
    addPage('p3');

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });
    const firstRun = charges().map((c) => c.referenceId);
    expect(firstRun).toEqual([
      ocrBatchReferenceId('job-1', ['p1', 'p2']),
      ocrBatchReferenceId('job-1', ['p3']),
    ]);
    expect(firstRun[0]).not.toBe(firstRun[1]);

    // Reclaim téhož jobu: p1 a p2 už jsou hotové, nový běh má jedinou dávku [p3]
    // s indexem 0. Dřívější klíč `batch-job-1-0` by kolidoval s první dávkou.
    for (const id of ['p1', 'p2']) {
      pages.get(id)!.document = {
        id: `doc-${id}`,
        context: '',
        translations: [{ language: 'cs', text: 'hotovo' }],
        glossary: [],
      };
    }
    billing.settleCreditHold.mockClear();

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });
    const secondRun = charges().map((c) => c.referenceId);

    expect(secondRun).toHaveLength(1);
    expect(secondRun[0]).not.toBe(firstRun[0]);
    // Stejná jednotka práce (stránka p3 v témže jobu) → stejný klíč → neúčtuje se dvakrát
    expect(secondRun[0]).toBe(firstRun[1]);
  });

  it('klíč nezávisí na pořadí stránek a liší se mezi joby', () => {
    expect(ocrBatchReferenceId('job-1', ['b', 'a'])).toBe(ocrBatchReferenceId('job-1', ['a', 'b']));
    expect(ocrBatchReferenceId('job-1', ['a'])).not.toBe(ocrBatchReferenceId('job-2', ['a']));
    expect(ocrBatchReferenceId('job-1', ['a'])).toMatch(/^ocr-batch:job-1:[0-9a-f]{32}$/);
  });

  it('odečte hned po volání API, ještě před uložením výsledků', async () => {
    addPage('p1');

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const deductOrder = billing.settleCreditHold.mock.invocationCallOrder[0]!;
    const saveOrder = mocks.prisma.document.create.mock.invocationCallOrder[0]!;
    expect(deductOrder).toBeLessThan(saveOrder);
  });
});

// ── DAT-1 ────────────────────────────────────────────────────
describe('processPages – regenerace existujícího dokumentu (DAT-1)', () => {
  const existingDocument = {
    id: 'doc-1',
    batchId: null,
    context: 'starý kontext',
    translations: [
      { language: 'cs', text: 'starý překlad' },
      { language: 'en', text: 'old translation' },
    ],
    glossary: [{ term: 'starý', definition: 'termín' }],
  };

  beforeEach(() => {
    mocks.tx.document.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-1',
      transcription: 'starý přepis',
      context: 'starý kontext',
      translations: existingDocument.translations,
    });
  });

  it('stránku s dokumentem nepřeskočí, nededuplikuje a výsledek zapíše do existujícího dokumentu', async () => {
    addPage('p1', { status: 'processing', document: existingDocument });

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    // Projde OCR, bez dedup dotazu
    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.findFirst).not.toHaveBeenCalled();
    // Žádný nový dokument ani překlad mimo transakci
    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    expect(mocks.prisma.translation.create).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);

    // Předchozí hodnoty jako verze ai_regenerate s novým modelem, čísla navazují
    expect(mocks.tx.documentVersion.createMany).toHaveBeenCalledWith({
      data: [
        {
          documentId: 'doc-1',
          version: 5,
          field: 'transcription',
          content: 'starý přepis',
          source: 'ai_regenerate',
          model: 'claude-opus-4-6',
        },
        {
          documentId: 'doc-1',
          version: 6,
          field: 'context',
          content: 'starý kontext',
          source: 'ai_regenerate',
          model: 'claude-opus-4-6',
        },
        {
          documentId: 'doc-1',
          version: 7,
          field: 'translation:cs',
          content: 'starý překlad',
          source: 'ai_regenerate',
          model: 'claude-opus-4-6',
        },
      ],
    });

    // Dokument se aktualizuje na místě (nový obsah, metadata, značka jobu)
    const update = mocks.tx.document.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: 'doc-1' });
    expect(update.data).toMatchObject({
      transcription: 'přepis 0',
      context: 'kontext 0',
      rawResponse: '{}',
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      batchId: 'job-1',
      // Skutečný odečet za nový výsledek (BIL-11): Opus 4.6 1000 × $5 + 500 × $25
      chargedCredits: 16_100,
    });
    // Glosář se nahradí
    expect(mocks.tx.glossaryEntry.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });

    // Překlad cílového jazyka se přepíše, ostatní jazyky zůstanou
    expect(mocks.tx.translation.upsert).toHaveBeenCalledTimes(1);
    const upsert = mocks.tx.translation.upsert.mock.calls[0]![0];
    expect(upsert.where).toEqual({ documentId_language: { documentId: 'doc-1', language: 'cs' } });
    expect(upsert.update).toMatchObject({
      text: 'překlad 0',
      context: null,
      glossaryJson: null,
      // Cena dřívější retranslace se u přepsaného překladu nezobrazuje (BIL-11)
      chargedCredits: null,
    });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
    // Účtuje se jako běžné OCR
    expect(billing.settleCreditHold).toHaveBeenCalledTimes(1);
  });

  it('nezměněná pole verzi nevytváří', async () => {
    addPage('p1', { status: 'processing', document: existingDocument });
    mocks.tx.document.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-1',
      transcription: 'přepis 0',
      context: 'kontext 0',
      translations: [{ language: 'cs', text: 'překlad 0' }],
    });

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    expect(mocks.tx.documentVersion.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.document.update).toHaveBeenCalledTimes(1);
  });

  it('bez příznaku regenerate se stránka s překladem dál přeskakuje', async () => {
    addPage('p1', { document: existingDocument });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    // Přeskočená stránka nesmí zůstat ve stavu 'processing'.
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('stránku, kterou tento job už přegeneroval (restart workeru), znovu neposílá', async () => {
    addPage('p1', {
      status: 'processing',
      document: { ...existingDocument, batchId: 'job-1' },
    });

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('nepovedená regenerace nechá dokument beze změny a stránku ve stavu done s chybou', async () => {
    addPage('p1', { status: 'processing', document: existingDocument });
    mocks.processWithClaudeBatch.mockResolvedValue({
      results: [],
      rawResponse: '',
      processingTimeMs: 1000,
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 10,
      stopReason: 'end_turn',
      declinedAttempts: [],
      truncated: false,
      parseProblem: null,
    });

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: 'Model nevrátil výsledek pro tuto stránku' },
    });
  });

  it('při kolizi čísla verze (P2002) transakci zopakuje', async () => {
    addPage('p1', { status: 'processing', document: existingDocument });
    let calls = 0;
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      return fn(mocks.tx);
    });

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('nedostatek kreditu vrátí stránku s dokumentem do done, bez dokumentu do pending', async () => {
    addPage('p1', { status: 'processing', document: existingDocument });
    refuseReservations(0);

    await processPages({ ...baseJob, pageIds: ['p1'], regenerate: true });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, status: 'processing', document: { isNot: null } },
      data: { status: 'done', errorMessage: null },
    });
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });
});

// ── Serverový fallback: odmítnuté pokusy (review 2026-10, nález 1) ──
describe('processPages – účtování odmítnutých pokusů serverového fallbacku', () => {
  function fallbackResult(
    declinedAttempts: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      category: string | null;
    }[],
  ) {
    return {
      results: [{ index: 0, result: ocrResult(0) }],
      rawResponse: '{}',
      processingTimeMs: 1000,
      model: 'claude-opus-5',
      inputTokens: 3100,
      outputTokens: 2500,
      stopReason: 'end_turn',
      truncated: false,
      parseProblem: null,
      declinedAttempts,
    };
  }

  it('odmítnuté pokusy naúčtuje zvlášť jejich modelem podle kategorie a výstupu', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockResolvedValue(
      fallbackResult([
        // uprostřed výstupu → vždy
        { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 420, category: 'cyber' },
        // před výstupem v účtované kategorii → účtuje se
        { model: 'claude-opus-4-8', inputTokens: 3050, outputTokens: 0, category: 'bio' },
        // před výstupem v neúčtované kategorii / bez kategorie → ne
        { model: 'claude-opus-4-8', inputTokens: 3050, outputTokens: 0, category: 'cyber' },
        { model: 'claude-opus-4-8', inputTokens: 3050, outputTokens: 0, category: null },
      ]),
    );

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const batchRef = ocrBatchReferenceId('job-1', ['p1']);
    // Hlavní položka = top-level usage s modelem, který odpověděl; odmítnuté pokusy
    // zvlášť v téže rezervaci
    expect(billing.settleCreditHold).toHaveBeenCalledTimes(1);
    expect(chargeRows()).toEqual([
      [3100, 2500, batchRef, 'claude-opus-5'],
      [3000, 420, `${batchRef}:declined:0`, 'claude-opus-5-5'],
      [3050, 0, `${batchRef}:declined:1`, 'claude-opus-4-8'],
    ]);
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
  });

  it('odmítnutí celého řetězce: poslední pokus i dřívější odmítnuté pokusy s klíčem odmítnutí', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockRejectedValue(
      new OcrRefusalError(
        'bio',
        { model: 'claude-opus-5', inputTokens: 3100, outputTokens: 0, category: 'bio' },
        [{ model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 15, category: 'cyber' }],
      ),
    );

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const refusedRef = ocrBatchRefusedReferenceId('job-1', ['p1']);
    expect(chargeRows()).toEqual([
      // poslední pokus odmítl před výstupem, ale v účtované kategorii bio
      [3100, 0, refusedRef, 'claude-opus-5'],
      [3000, 15, `${refusedRef}:declined:0`, 'claude-opus-5-5'],
    ]);
    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
  });

  it.each([['cyber'], [null]])(
    'odmítnutí před výstupem v kategorii %s se neúčtuje',
    async (category) => {
      addPage('p1');
      mocks.processWithClaudeBatch.mockRejectedValue(
        new OcrRefusalError(category, {
          model: 'claude-opus-5-5',
          inputTokens: 3000,
          outputTokens: 0,
          category,
        }),
      );

      await processPages({ ...baseJob, pageIds: ['p1'] });

      expect(charges()).toEqual([]);
      // Rezervace se uzavře bez odečtu (nevisí do úklidu)
      expect(billing.settleCreditHold).toHaveBeenCalledWith(expect.anything(), []);
      expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: { not: 'archived' } },
        data: { status: 'error', errorMessage: expect.stringContaining('odmítl') },
      });
    },
  );

  it('odmítnutí před výstupem v kategorii bio se účtuje', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockRejectedValue(
      new OcrRefusalError('bio', {
        model: 'claude-opus-5-5',
        inputTokens: 3000,
        outputTokens: 0,
        category: 'bio',
      }),
    );

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(chargeRows()).toEqual([
      [3000, 0, ocrBatchRefusedReferenceId('job-1', ['p1']), 'claude-opus-5-5'],
    ]);
  });
});

// ── Odlišný klíč odmítnuté dávky (review 2026-10, nález 2) ──
describe('processPages – referenceId odmítnuté dávky', () => {
  it('po reclaimu úspěšné OCR téže sady stránek nesdílí klíč s odmítnutím', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockRejectedValueOnce(
      new OcrRefusalError('bio', {
        model: 'claude-opus-5-5',
        inputTokens: 3000,
        outputTokens: 40,
        category: 'bio',
      }),
    );

    await processPages({ ...baseJob, pageIds: ['p1'] });
    const refusedKey = charges()[0]!.referenceId;
    billing.settleCreditHold.mockClear();

    // Reclaim téhož jobu – tentokrát model stránku zpracuje
    await processPages({ ...baseJob, pageIds: ['p1'] });
    const successKey = charges()[0]!.referenceId;

    expect(refusedKey).toBe(ocrBatchRefusedReferenceId('job-1', ['p1']));
    expect(successKey).toBe(ocrBatchReferenceId('job-1', ['p1']));
    expect(successKey).not.toBe(refusedKey);
    expect(ocrBatchRefusedReferenceId('job-1', ['p1'])).toMatch(
      /^ocr-batch-refused:job-1:[0-9a-f]{32}$/,
    );
  });
});

// ── Chybějící soubor obrázku (review 2026-10, nález 5) ──
describe('processPages – chybějící soubor obrázku', () => {
  function enoent(path: string): Error {
    return Object.assign(
      new Error(`ENOENT: no such file or directory, open '/srv/uploads/${path}'`),
      { code: 'ENOENT' },
    );
  }

  it('v přípravě: stránka skončí chybou bez serverové cesty, ostatní se zpracují', async () => {
    addPage('p1');
    addPage('p2');
    mocks.storageRead.mockImplementation(async (path: string) => {
      if (path === 'p1.jpg') throw enoent(path);
      return Buffer.from(`image:${path}`);
    });

    await expect(processPages({ ...baseJob, pageIds: ['p1', 'p2'] })).resolves.toBeUndefined();

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: IMAGE_UNREADABLE_MESSAGE },
    });
    // Do API jde jen p2
    const images = mocks.processWithClaudeBatch.mock.calls[0]![0] as { pageId: string }[];
    expect(images.map((i) => i.pageId)).toEqual(['p2']);
    expect(mocks.prisma.document.create.mock.calls[0]![0].data.pageId).toBe('p2');
    // Job doběhne (ne vše selhalo) a chyba stránky je v errors bez cesty
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.status).toBe('completed');
    expect(lastJobUpdate.data.errors).toEqual([`Stránka p1: ${IMAGE_UNREADABLE_MESSAGE}`]);
    expect(JSON.stringify(lastJobUpdate.data.errors)).not.toContain('/srv/');
  });

  it('jediná stránka s chybějícím obrázkem: job skončí chybou, nespadne', async () => {
    addPage('p1');
    mocks.storageRead.mockRejectedValue(enoent('p1.jpg'));

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      errors: [`Stránka p1: ${IMAGE_UNREADABLE_MESSAGE}`],
    });
  });

  it('soubor zmizí mezi přípravou a dávkou: stránka skončí chybou bez serverové cesty', async () => {
    addPage('p1');
    addPage('p2');
    let reads = 0;
    mocks.storageRead.mockImplementation(async (path: string) => {
      // příprava čte p1, p2; dávka pak p1 (zmizel) a p2
      reads++;
      if (path === 'p1.jpg' && reads > 2) throw enoent(path);
      return Buffer.from(`image:${path}`);
    });

    await processPages({ ...baseJob, pageIds: ['p1', 'p2'] });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: IMAGE_UNREADABLE_MESSAGE },
    });
    const images = mocks.processWithClaudeBatch.mock.calls[0]![0] as { pageId: string }[];
    expect(images.map((i) => i.pageId)).toEqual(['p2']);
  });
});

// ── Značky reclaimu v errors (review 2026-10, nález 6) ──
describe('processPages – přepis errors zachová značky reclaimu', () => {
  const marker = `${RECLAIM_MARKER} (obnova 1/2)`;

  it('mezikrokový i závěrečný zápis errors značky ponechá', async () => {
    // Max. 2 stránky na dávku → [p1, p2] (odmítnuto), [p3]
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    addPage('p1');
    addPage('p2');
    addPage('p3');
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      status: 'running',
      errors: [marker, 'Stránka p9: stará chyba z přerušeného běhu'],
    });
    const ocrDefault = mocks.processWithClaudeBatch.getMockImplementation()!;
    mocks.processWithClaudeBatch
      .mockRejectedValueOnce(
        new OcrRefusalError('bio', {
          model: 'claude-opus-5-5',
          inputTokens: 3000,
          outputTokens: 40,
          category: 'bio',
        }),
      )
      .mockImplementation(ocrDefault);

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    const errorWrites = mocks.prisma.processingJob.update.mock.calls
      .map((c) => c[0].data.errors as string[] | undefined)
      .filter((e): e is string[] => Array.isArray(e));
    // mezikrokový zápis po odmítnuté dávce + závěrečný
    expect(errorWrites).toHaveLength(2);
    for (const errors of errorWrites) {
      expect(errors[0]).toBe(marker);
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Stránka p1:')]));
      // Staré chyby (ne značky) se nepřenášejí
      expect(errors).not.toContain('Stránka p9: stará chyba z přerušeného běhu');
    }
  });

  it('zápis při nedostatku kreditu značky ponechá', async () => {
    addPage('p1');
    refuseReservations(0);
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      status: 'running',
      errors: [marker],
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.errors).toEqual([
      marker,
      expect.stringContaining('Nedostatečný kredit pro zpracování'),
    ]);
  });
});

// ── stop_reason u překladu existujícího dokumentu (review 2026-10, nález 3) ──
describe('processPages – překlad existujícího dokumentu do dalšího jazyka', () => {
  beforeEach(() => {
    addPage('p1', {
      document: {
        id: 'doc-1',
        context: 'kontext',
        translations: [{ language: 'en', text: 'English translation' }],
        glossary: [],
      },
    });
  });

  it('useknutý výstup (max_tokens) neuloží, ale naúčtuje', async () => {
    mocks.createMessage.mockResolvedValue({
      text: '{"translation": "useknutý překl',
      model: 'claude-sonnet-4-6',
      inputTokens: 1200,
      outputTokens: 8192,
      stopReason: 'max_tokens',
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.translation.upsert).not.toHaveBeenCalled();
    expect(chargeRows()).toEqual([
      [1200, 8192, 'translate-doc-job-1-doc-1-cs', 'claude-sonnet-4-6'],
    ]);
    // Stránka má dokument → zůstane done, chyba v errorMessage
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: expect.stringContaining('nevrátil kompletní překlad') },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.errors).toEqual([
      expect.stringContaining('nevrátil kompletní překlad'),
    ]);
  });

  it('kompletní výstup uloží', async () => {
    mocks.createMessage.mockResolvedValue({
      text: '{"translation": "Český překlad", "context": "kontext", "glossary": []}',
      model: 'claude-sonnet-4-6',
      inputTokens: 1200,
      outputTokens: 300,
      stopReason: 'end_turn',
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.translation.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.translation.upsert.mock.calls[0]![0].create.text).toBe('Český překlad');
    expect(billing.settleCreditHold).toHaveBeenCalledTimes(1);
  });

  it('bez volného kreditu model nezavolá a stránka dostane srozumitelnou chybu', async () => {
    refuseReservations(100, 200_000);

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: INSUFFICIENT_CREDIT_PAGE_MESSAGE },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.errors[0]).toMatch(/200\s000 tokenů, volných je 100/);
    expect(lastJobUpdate.data.errorCode).toBe('insufficient_credit');
  });
});

// ── BIL-1: rezervace kreditu před OCR dávkou ─────────────────
describe('processPages – rezervace kreditu (BIL-1)', () => {
  it('před každou dávkou zarezervuje maximální cenu a po volání vyúčtuje skutečnou spotřebu', async () => {
    addPage('p1');

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(billing.reserveCredits).toHaveBeenCalledTimes(1);
    const reserve = billing.reserveCredits.mock.calls[0]![0];
    expect(reserve).toMatchObject({
      userId: 'user-1',
      jobId: 'job-1',
      referenceId: ocrBatchReferenceId('job-1', ['p1']),
    });
    // Rezervace = horní odhad: celý max_tokens dávky sazbou primárního modelu
    // (16k + 8k výstupních tokenů × $20 za 1M u Opus 5.5 → ≥ 441 600 kreditů)
    expect(reserve.amount).toBeGreaterThanOrEqual(441_600);
    const reserveOrder = billing.reserveCredits.mock.invocationCallOrder[0]!;
    const ocrOrder = mocks.processWithClaudeBatch.mock.invocationCallOrder[0]!;
    expect(reserveOrder).toBeLessThan(ocrOrder);
    expect(chargeRows()).toEqual([
      [1000, 500, ocrBatchReferenceId('job-1', ['p1']), 'claude-opus-4-6'],
    ]);
  });

  it('při nízkém zůstatku dávku zmenší na stránky, na které stačí volný kredit', async () => {
    addPage('p1');
    addPage('p2');
    addPage('p3');
    // Volný kredit stačí na rezervaci dávky o 2 stránkách, ne o 3
    const { ocrBatchReservationCredits } = await import('@ai-sedlacek/ocr');
    const twoPages = ocrBatchReservationCredits(
      2,
      '\nPřepiš text z tohoto rukopisu.',
      'transcribe+translate',
    );
    billing.getCreditState.mockResolvedValue({
      balance: twoPages + 10,
      reserved: 0,
      available: twoPages + 10,
    });

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    const sent = mocks.processWithClaudeBatch.mock.calls.map((c) =>
      (c[0] as { pageId: string }[]).map((i) => i.pageId),
    );
    expect(sent).toEqual([['p1', 'p2'], ['p3']]);
  });

  it('bez kreditu ani na jednu stránku model nezavolá a job skončí srozumitelnou chybou', async () => {
    addPage('p1');
    refuseReservations(1000);

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      currentStep: 'Nedostatečný kredit',
      errorCode: 'insufficient_credit',
    });
    expect(lastJobUpdate.data.errors[0]).toMatch(/potřebuje rezervovat .* tokenů, volných je 1/);
  });

  it('souběžný job vyčerpal kredit mezi odhadem a rezervací: stop bez volání API', async () => {
    addPage('p1');
    billing.reserveCredits.mockResolvedValue({ ok: false, required: 600_000, available: 5 });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });

  it('chyba API bez spotřeby rezervaci uvolní a job selže', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockRejectedValue(new Error('overloaded'));

    await expect(processPages({ ...baseJob, pageIds: ['p1'] })).rejects.toThrow('overloaded');

    expect(billing.releaseCreditHold).toHaveBeenCalledTimes(1);
    expect(billing.settleCreditHold).not.toHaveBeenCalled();
  });
});

// ── Přerušený stream (známé omezení PR #7, review) ──────────
// Stream spadl uprostřed generování: processWithClaudeBatch vrátí kompletní
// stránky s příznakem `interrupted` a spotřebou ze snapshotu – zaplacený výstup
// se nezahazuje, zbytek dávky skončí chybou a job pokračuje jako u useknutí.
describe('processPages – stream přerušený uprostřed generování', () => {
  function interruptedResult(
    completeIndices: number[],
    usage = { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 1100 },
  ) {
    return {
      results: completeIndices.map((index) => ({ index, result: ocrResult(index) })),
      rawResponse: '{"imageIndex": 0 …',
      processingTimeMs: 1000,
      ...usage,
      stopReason: null,
      truncated: false,
      interrupted: true,
      parseProblem: null,
      declinedAttempts: [],
    };
  }

  it('kompletní stránky uloží, zbytek označí pevnou hláškou a vyúčtuje s klíčem přerušení', async () => {
    addPage('p1', { collection: { id: 'col-1', context: '' } });
    addPage('p2', { collection: { id: 'col-1', context: '' } });
    mocks.processWithClaudeBatch.mockResolvedValue(interruptedResult([0]));

    await expect(processPages({ ...baseJob, pageIds: ['p1', 'p2'] })).resolves.toBeUndefined();

    // p1 kompletní → uložena (zaplacený výstup se nezahazuje)
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create.mock.calls[0]![0].data.pageId).toBe('p1');
    // p2 → pevná hláška bez surové chyby
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: BATCH_INTERRUPTED_MESSAGE },
    });
    // Spotřeba ze snapshotu s vlastním deterministickým klíčem a svazkem,
    // z rezervace dávky (žádný odečet mimo rezervaci), nic se neuvolňuje
    const interruptedRef = ocrBatchInterruptedReferenceId('job-1', ['p1', 'p2']);
    expect(chargeRows()).toEqual([[3000, 1100, interruptedRef, 'claude-opus-5-5']]);
    expect(charges()[0]!.description).toContain('přerušeno');
    expect(charges()[0]!.collectionId).toBe('col-1');
    expect(billing.settleCreditHold).toHaveBeenCalledTimes(1);
    expect(billing.settleCreditHold.mock.calls[0]![0]).toMatchObject({
      referenceId: ocrBatchReferenceId('job-1', ['p1', 'p2']),
    });
    expect(billing.releaseCreditHold).not.toHaveBeenCalled();
    // Job doběhne (ne všechny stránky chybou) – errors s pevnou hláškou
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'completed',
      errors: [`Stránka p2: ${BATCH_INTERRUPTED_MESSAGE}`],
    });
  });

  it('přerušená dávka, která něco uložila, nezastaví job – pokračuje dalšími dávkami', async () => {
    // Průměr 8000 tokenů/stránku → max. 2 stránky na dávku: [p1, p2], [p3]
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    addPage('p1');
    addPage('p2');
    addPage('p3');
    const ocrDefault = mocks.processWithClaudeBatch.getMockImplementation()!;
    mocks.processWithClaudeBatch
      .mockResolvedValueOnce(interruptedResult([0]))
      .mockImplementation(ocrDefault);

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.document.create.mock.calls.map((c) => c[0].data.pageId)).toEqual([
      'p1',
      'p3',
    ]);
    expect(chargeRows().map((r) => r[2])).toEqual([
      ocrBatchInterruptedReferenceId('job-1', ['p1', 'p2']),
      ocrBatchReferenceId('job-1', ['p3']),
    ]);
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: BATCH_INTERRUPTED_MESSAGE },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.status).toBe('completed');
  });

  // Výpadek API: další dávky by platily vstup (obrázky) znovu za nic
  it('přerušená dávka bez uložené stránky: zbytek fronty nespustí, vrátí ho a job skončí api_error', async () => {
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) addPage(id);
    mocks.processWithClaudeBatch.mockResolvedValueOnce(interruptedResult([]));

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3', 'p4', 'p5'] });

    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
    // Přerušená dávka se vyúčtuje, další se nerezervují
    expect(chargeRows().map((r) => r[2])).toEqual([
      ocrBatchInterruptedReferenceId('job-1', ['p1', 'p2']),
    ]);
    expect(billing.reserveCredits).toHaveBeenCalledTimes(1);
    // Stránky přerušené dávky chybou, zbytek fronty zpět ke zpracování
    for (const id of ['p1', 'p2']) {
      expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
        where: { id, status: { not: 'archived' } },
        data: { status: 'error', errorMessage: BATCH_INTERRUPTED_MESSAGE },
      });
    }
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p3', 'p4', 'p5'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      errorCode: 'api_error',
      errors: expect.arrayContaining([JOB_STOPPED_INTERRUPTED_MESSAGE]),
    });
  });

  it('dvě přerušené dávky po sobě (i s uloženými stránkami): třetí nespustí', async () => {
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) addPage(id);
    mocks.processWithClaudeBatch
      .mockResolvedValueOnce(interruptedResult([0]))
      .mockResolvedValueOnce(interruptedResult([0]));

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3', 'p4', 'p5'] });

    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(2);
    // Hotové stránky obou dávek uložené (zaplacený výstup se nezahazuje)
    expect(mocks.prisma.document.create.mock.calls.map((c) => c[0].data.pageId)).toEqual([
      'p1',
      'p3',
    ]);
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p5'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({ status: 'error', errorCode: 'api_error' });
  });

  it('úspěšná dávka mezi přerušeními počítadlo přerušení vynuluje', async () => {
    mocks.prisma.document.aggregate.mockResolvedValue({ _avg: { outputTokens: 8000 } });
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) addPage(id);
    const ocrDefault = mocks.processWithClaudeBatch.getMockImplementation()!;
    mocks.processWithClaudeBatch
      .mockResolvedValueOnce(interruptedResult([0]))
      .mockImplementationOnce(ocrDefault)
      .mockResolvedValueOnce(interruptedResult([0]))
      .mockImplementation(ocrDefault);

    await processPages({
      ...baseJob,
      pageIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
    });

    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(4);
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.status).toBe('completed');
  });

  it('přerušení má přednost před problémem s přiřazením (neúplné číslování)', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockResolvedValue({
      ...interruptedResult([]),
      parseProblem: 'Model vrátil imageIndex mimo očekávané číslování (1) pro 1 obrázků',
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: BATCH_INTERRUPTED_MESSAGE },
    });
  });

  it('odmítnuté pokusy fallbacku se účtují s klíčem odvozeným od klíče přerušení', async () => {
    addPage('p1');
    mocks.processWithClaudeBatch.mockResolvedValue({
      ...interruptedResult([], { model: 'claude-opus-5', inputTokens: 3100, outputTokens: 500 }),
      declinedAttempts: [
        { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 0, category: 'bio' },
      ],
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const ref = ocrBatchInterruptedReferenceId('job-1', ['p1']);
    expect(chargeRows()).toEqual([
      [3100, 500, ref, 'claude-opus-5'],
      [3000, 0, `${ref}:declined:0`, 'claude-opus-5-5'],
    ]);
  });

  it('klíč přerušení se liší od klíče úspěšného OCR i odmítnutí téže sady stránek', () => {
    const key = ocrBatchInterruptedReferenceId('job-1', ['p2', 'p1']);
    expect(key).toBe(ocrBatchInterruptedReferenceId('job-1', ['p1', 'p2']));
    expect(key).toMatch(/^ocr-batch-interrupted:job-1:[0-9a-f]{32}$/);
    expect(key).not.toBe(ocrBatchReferenceId('job-1', ['p1', 'p2']));
    expect(key).not.toBe(ocrBatchRefusedReferenceId('job-1', ['p1', 'p2']));
  });

  it('selhání vyúčtování: hotové stránky uloží a další dávky zastaví (jako R-9)', async () => {
    addPage('p1');
    billing.settleCreditHold.mockRejectedValue(new Error('DB connection lost'));
    mocks.processWithClaudeBatch.mockResolvedValue(interruptedResult([0]));

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(billing.releaseCreditHold).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.create).toHaveBeenCalledTimes(1);
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.currentStep).toBe('Odečet kreditu selhal');
  });
});

// ── BIL-11: skutečný odečet u dokumentu a svazku ─────────────
describe('processPages – skutečný odečet k dokumentu a svazku (BIL-11)', () => {
  it('rozpočítá odečet dávky (i odmítnuté pokusy) na stránky a položky označí svazkem', async () => {
    addPage('p1', { collection: { id: 'col-1', context: '' } });
    addPage('p2', { collection: { id: 'col-1', context: '' } });
    const ocrDefault = mocks.processWithClaudeBatch.getMockImplementation()!;
    mocks.processWithClaudeBatch.mockImplementation(async (...args: unknown[]) => ({
      ...(await ocrDefault(...args)),
      model: 'claude-opus-5-5',
      inputTokens: 2000,
      outputTokens: 4000,
      declinedAttempts: [
        { model: 'claude-opus-5-5', inputTokens: 2000, outputTokens: 100, category: 'bio' },
      ],
    }));

    await processPages({ ...baseJob, pageIds: ['p1', 'p2'], collectionId: 'col-1' });

    // Každá položka ledgeru nese svazek → cena svazku = součet skutečných odečtů
    expect(charges().map((c) => c.collectionId)).toEqual(['col-1', 'col-1']);
    // Opus 5.5: (2000 × 4 + 4000 × 20) + (2000 × 4 + 100 × 20) = 98 000 → × 46 / 50 = 90 160
    const perPage = Math.round(90_160 / 2);
    const saved = mocks.prisma.document.create.mock.calls.map((c) => c[0].data.chargedCredits);
    expect(saved).toEqual([perPage, perPage]);
  });

  it('při selhání vyúčtování zůstane odečet u dokumentu neznámý (null)', async () => {
    addPage('p1');
    billing.settleCreditHold.mockRejectedValue(new Error('DB down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.document.create.mock.calls[0]![0].data.chargedCredits).toBeNull();
  });

  it('deduplikovaná kopie nese cenu kopie, kopie překladů se neúčtují', async () => {
    addPage('p1');
    mocks.prisma.document.findFirst.mockResolvedValue({
      id: 'own-doc',
      hash: 'h',
      rawResponse: null,
      transcription: 't',
      detectedLanguage: 'la',
      context: 'k',
      model: 'claude-opus-5-5',
      inputTokens: 1000,
      outputTokens: 500,
      processingTimeMs: 10,
      translations: [
        { language: 'cs', text: 'p', model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 5 },
      ],
      glossary: [],
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    const data = mocks.prisma.document.create.mock.calls[0]![0].data;
    // Opus 5.5: 1000 × $4 + 500 × $20 → 12 880 kreditů
    expect(data.chargedCredits).toBe(12_880);
    expect(data.translations.create[0].chargedCredits).toBe(0);
  });
});

// ── Souběh jobů téhož uživatele: kredit blokuje rezervace jiného jobu ──
describe('processPages – kredit blokovaný jiným jobem (credit_busy)', () => {
  function lastJobData(): Record<string, unknown> {
    return mocks.prisma.processingJob.update.mock.calls.at(-1)![0].data;
  }

  it('dávku nespustí, job skončí credit_busy a stránky se vrátí do pending', async () => {
    addPage('p1');
    blockReservationsByOtherHolds();

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(lastJobData()).toMatchObject({
      status: 'error',
      errorCode: 'credit_busy',
      currentStep: 'Kredit rezervovaný jiným zpracováním',
    });
    // Detail s částkami jen do errors jobu
    expect((lastJobData().errors as string[])[0]).toMatch(
      /dočasně rezervovaný jiným běžícím zpracováním.*zůstatek 500\s100, rezervováno 600\s000/,
    );
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });

  it('rezervace odmítnutá kvůli souběžnému jobu → credit_busy, ne insufficient_credit', async () => {
    addPage('p1');
    billing.reserveCredits.mockResolvedValue({
      ok: false,
      required: 500_000,
      available: 100_000,
      balance: 900_000,
      reserved: 800_000,
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.processWithClaudeBatch).not.toHaveBeenCalled();
    expect(lastJobData()).toMatchObject({ status: 'error', errorCode: 'credit_busy' });
  });

  it('skutečný nedostatek zůstává insufficient_credit', async () => {
    addPage('p1');
    refuseReservations(1000);

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(lastJobData()).toMatchObject({ status: 'error', errorCode: 'insufficient_credit' });
  });

  it('kopie při kreditu blokovaném jiným jobem: chyba credit_busy, nic se nezkopíruje', async () => {
    addPage('p1');
    mocks.prisma.document.findFirst.mockResolvedValue({
      id: 'own-doc',
      hash: 'h',
      model: 'claude-opus-4-6',
      inputTokens: 100,
      outputTokens: 50,
      translations: [],
      glossary: [],
    });
    blockReservationsByOtherHolds(5000, 6000);

    const err: unknown = await processPages({ ...baseJob, pageIds: ['p1'] }).catch((e) => e);

    // Job ukončí worker (handleJobFailure): error, credit_busy, stránky zpět do pending
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ code: 'credit_busy' });
    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
  });
});

// ── Surové chyby SDK/DB se do Page.errorMessage nedostanou (review 3. kolo) ──
describe('processPages – hlášky stránek bez surových chyb', () => {
  it('selhané uložení výsledku: obecná hláška, surová chyba DB jen do logu', async () => {
    addPage('p1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.prisma.document.create.mockRejectedValue(
      new Error(
        'Invalid `prisma.document.create()` invocation: Unique constraint failed on pageId',
      ),
    );

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'error', errorMessage: RESULT_SAVE_FAILED_MESSAGE },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(JSON.stringify(lastJobUpdate.data.errors)).not.toContain('prisma');
  });

  it('selhaný překlad existujícího dokumentu: obecná hláška místo surové chyby', async () => {
    addPage('p1', {
      document: {
        id: 'doc-1',
        context: 'k',
        translations: [{ language: 'en', text: 'English' }],
        glossary: [],
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createMessage.mockRejectedValue(new Error('PrismaClientKnownRequestError: P1001'));

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: TRANSLATION_FAILED_MESSAGE },
    });
  });

  it('useknutý překlad existujícího dokumentu: vlastní srozumitelná hláška zůstává', async () => {
    addPage('p1', {
      document: {
        id: 'doc-1',
        context: 'k',
        translations: [{ language: 'en', text: 'English' }],
        glossary: [],
      },
    });
    mocks.createMessage.mockResolvedValue({
      text: '{"translation": "useknut',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 8192,
      stopReason: 'max_tokens',
    });

    await processPages({ ...baseJob, pageIds: ['p1'] });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: expect.stringContaining('nevrátil kompletní překlad') },
    });
  });
});
