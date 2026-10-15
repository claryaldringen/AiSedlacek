import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocky ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  prisma: {
    collection: { findUnique: vi.fn() },
    page: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    document: { aggregate: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
  checkBalance: vi.fn(),
  deductTokensIfSufficient: vi.fn(),
  createVersion: vi.fn(),
  processWithClaudeBatch: vi.fn(),
  prepareImage: vi.fn(),
  storageRead: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', () => ({
  checkBalance: mocks.checkBalance,
  deductTokensIfSufficient: mocks.deductTokensIfSufficient,
}));
vi.mock('@ai-sedlacek/db/versioning', () => ({ createVersion: mocks.createVersion }));
vi.mock('@ai-sedlacek/ocr', () => ({
  prepareImage: mocks.prepareImage,
  processWithClaudeBatch: mocks.processWithClaudeBatch,
  processWithClaudeBatchCli: vi.fn(),
}));
vi.mock('../lib/storage', () => ({ getStorage: () => ({ read: mocks.storageRead }) }));
vi.mock('../lib/llm', () => ({ isCliMode: () => false, createMessage: vi.fn() }));

import { processPages, ocrBatchReferenceId } from '../handlers/process-pages';

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
    async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => pages.has(id)).map((id) => ({ id, order: pages.get(id)!.order })),
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

  mocks.checkBalance.mockResolvedValue({ balance: 1_000_000, sufficient: true });
  mocks.deductTokensIfSufficient.mockResolvedValue({ success: true, balance: 900_000 });
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
    // p2 → chyba s jasnou hláškou
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2', status: { not: 'archived' } },
      data: {
        status: 'error',
        errorMessage: expect.stringContaining('Obrázek nelze připravit pro OCR'),
      },
    });
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
    expect(mocks.deductTokensIfSufficient).toHaveBeenCalledTimes(1);
    const [, input, output] = mocks.deductTokensIfSufficient.mock.calls[0]!;
    expect([input, output]).toEqual([3000, 48000]);
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
    mocks.deductTokensIfSufficient.mockRejectedValue(new Error('P2034 serialization failure'));

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });

    // Jen první dávka šla do API – její výstup je zaplacený, proto se uloží.
    expect(mocks.processWithClaudeBatch).toHaveBeenCalledTimes(1);
    const savedPageIds = mocks.prisma.document.create.mock.calls.map((c) => c[0].data.pageId);
    expect(savedPageIds).toEqual(['p1', 'p2']);
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
      data: { documentId: 'legacy-doc', language: 'cs', text: 'překlad 0' },
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
    const firstRun = mocks.deductTokensIfSufficient.mock.calls.map((c) => c[4] as string);
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
    mocks.deductTokensIfSufficient.mockClear();

    await processPages({ ...baseJob, pageIds: ['p1', 'p2', 'p3'] });
    const secondRun = mocks.deductTokensIfSufficient.mock.calls.map((c) => c[4] as string);

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

    const deductOrder = mocks.deductTokensIfSufficient.mock.invocationCallOrder[0]!;
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
    });
    // Glosář se nahradí
    expect(mocks.tx.glossaryEntry.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });

    // Překlad cílového jazyka se přepíše, ostatní jazyky zůstanou
    expect(mocks.tx.translation.upsert).toHaveBeenCalledTimes(1);
    const upsert = mocks.tx.translation.upsert.mock.calls[0]![0];
    expect(upsert.where).toEqual({ documentId_language: { documentId: 'doc-1', language: 'cs' } });
    expect(upsert.update).toMatchObject({ text: 'překlad 0', context: null, glossaryJson: null });

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
    // Účtuje se jako běžné OCR
    expect(mocks.deductTokensIfSufficient).toHaveBeenCalledTimes(1);
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
    mocks.checkBalance.mockResolvedValue({ balance: 0, sufficient: false });

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
