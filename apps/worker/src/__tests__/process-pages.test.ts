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
  storageRead: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', () => ({
  checkBalance: mocks.checkBalance,
  deductTokensIfSufficient: mocks.deductTokensIfSufficient,
}));
vi.mock('@ai-sedlacek/db/versioning', () => ({ createVersion: mocks.createVersion }));
vi.mock('@ai-sedlacek/ocr', () => ({
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
