import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocky ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  prisma: {
    collection: { findUnique: vi.fn() },
    page: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    document: { aggregate: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    translation: { create: vi.fn(), upsert: vi.fn() },
    processingJob: { update: vi.fn(), findUnique: vi.fn() },
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

import { processPages } from '../handlers/process-pages';

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
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.processingJob.findUnique.mockResolvedValue({ status: 'running' });

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

  it('bez shody v rámci uživatele stránku zpracuje OCR (cizí dokument se nekopíruje)', async () => {
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
    expect(mocks.prisma.page.update).toHaveBeenCalledWith({
      where: { id: 'p2' },
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
    expect(mocks.prisma.page.update).toHaveBeenCalledWith({
      where: { id: 'p2' },
      data: { status: 'error', errorMessage: expect.stringContaining('useknut') },
    });
    // Účtuje se celé volání (skutečná spotřeba API), ne odhad
    expect(mocks.deductTokensIfSufficient).toHaveBeenCalledTimes(1);
    const [, input, output] = mocks.deductTokensIfSufficient.mock.calls[0]!;
    expect([input, output]).toEqual([3000, 48000]);
  });
});
