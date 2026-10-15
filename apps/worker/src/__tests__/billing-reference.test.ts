import { describe, it, expect, vi, beforeEach } from 'vitest';

// BIL-3: referenceId odečtů ve workeru musí být deterministický (dřív Date.now()),
// aby opakované zpracování téhož jobu po restartu workeru neúčtovalo dvakrát.

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { update: vi.fn() },
    document: { findUnique: vi.fn(), update: vi.fn() },
    translation: { upsert: vi.fn() },
    collection: { findUnique: vi.fn(), update: vi.fn() },
    page: { findMany: vi.fn() },
  },
  createMessage: vi.fn(),
  deductTokensIfSufficient: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', () => ({
  deductTokensIfSufficient: mocks.deductTokensIfSufficient,
}));
vi.mock('@ai-sedlacek/db/versioning', () => ({ createVersion: mocks.createVersion }));
vi.mock('../lib/llm', () => ({ createMessage: mocks.createMessage, isCliMode: () => false }));

import { handleRetranslate } from '../handlers/retranslate';
import { handleTranslateContext } from '../handlers/translate-context';
import { handleGenerateContext } from '../handlers/generate-context';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.translation.upsert.mockResolvedValue({});
  mocks.prisma.document.update.mockResolvedValue({});
  mocks.prisma.collection.update.mockResolvedValue({});
  mocks.deductTokensIfSufficient.mockResolvedValue({ success: true, balance: 1000 });
  mocks.createVersion.mockResolvedValue(undefined);
  mocks.createMessage.mockResolvedValue({
    text: '{"title": "Kronika"}',
    model: 'claude-sonnet-4-6',
    inputTokens: 100,
    outputTokens: 50,
    stopReason: 'end_turn',
  });
});

/** Spustí handler dvakrát (jako po reclaimu) a vrátí referenceId všech odečtů. */
async function referenceIdsOfTwoRuns(run: () => Promise<void>): Promise<string[][]> {
  const runs: string[][] = [];
  for (let i = 0; i < 2; i++) {
    mocks.deductTokensIfSufficient.mockClear();
    await run();
    runs.push(mocks.deductTokensIfSufficient.mock.calls.map((c) => c[4] as string));
    // Jiný čas mezi běhy – s Date.now() by se klíče lišily
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return runs;
}

describe('deterministické referenceId odečtů (BIL-3)', () => {
  it('retranslate', async () => {
    mocks.prisma.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'text',
      translations: [{ text: 'starý překlad' }],
      page: { userId: 'user-1', collection: null },
    });

    const [first, second] = await referenceIdsOfTwoRuns(() =>
      handleRetranslate('job-r', { documentId: 'doc-1', language: 'cs', userId: 'user-1' }),
    );

    expect(first).toEqual(['retranslate:job-r:doc-1:cs']);
    expect(second).toEqual(first);
    // Změna překladu posune Document.updatedAt (detekce konfliktu v `ais push`).
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('translate-context', async () => {
    mocks.prisma.collection.findUnique.mockResolvedValue({
      context: 'kontext',
      contextLanguage: 'cs',
      name: 'Svazek',
    });

    const [first, second] = await referenceIdsOfTwoRuns(() =>
      handleTranslateContext('job-t', {
        collectionId: 'col-1',
        targetLanguage: 'en',
        userId: 'user-1',
      }),
    );

    expect(first).toEqual(['translate-context:job-t:col-1:en']);
    expect(second).toEqual(first);
  });

  it('generate-context (kontext i metadata)', async () => {
    mocks.prisma.collection.findUnique.mockResolvedValue({
      id: 'col-1',
      userId: 'user-1',
      name: 'Svazek',
    });
    mocks.prisma.page.findMany.mockResolvedValue([
      { displayName: null, filename: 'a.jpg', document: { transcription: 'text' } },
    ]);

    const [first, second] = await referenceIdsOfTwoRuns(() =>
      handleGenerateContext('job-g', { collectionId: 'col-1', pageIds: ['p1'], userId: 'user-1' }),
    );

    // Pořadí odečtů není podstatné (hlavní volání se účtuje hned po něm) – jde
    // o deterministické klíče, shodné mezi běhy.
    expect([...(first ?? [])].sort()).toEqual([
      'generate-context-meta:job-g:col-1',
      'generate-context:job-g:col-1',
    ]);
    expect(second).toEqual(first);
  });
});

// DAT-2 / R-11: kontext svazku nemá historii – useknutý výstup ho nesmí přepsat.
describe('kontext svazku se nepřepíše neúplným výstupem modelu', () => {
  it('translate-context při max_tokens nechá kontext beze změny (ale účtuje)', async () => {
    mocks.prisma.collection.findUnique.mockResolvedValue({
      context: 'Původní kontext',
      contextLanguage: 'cs',
      name: 'Svazek',
    });
    mocks.createMessage.mockResolvedValue({
      text: 'Truncated transl',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 16000,
      stopReason: 'max_tokens',
    });

    await expect(
      handleTranslateContext('job-t', {
        collectionId: 'col-1',
        targetLanguage: 'en',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/beze změny/);

    expect(mocks.prisma.collection.update).not.toHaveBeenCalled();
    expect(mocks.deductTokensIfSufficient).toHaveBeenCalledTimes(1);
  });

  it('generate-context s prázdným výstupem nechá kontext beze změny', async () => {
    mocks.prisma.collection.findUnique.mockResolvedValue({
      id: 'col-1',
      userId: 'user-1',
      name: 'Svazek',
    });
    mocks.prisma.page.findMany.mockResolvedValue([
      { displayName: null, filename: 'a.jpg', document: { transcription: 'text' } },
    ]);
    mocks.createMessage.mockResolvedValue({
      text: '',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 0,
      stopReason: 'end_turn',
    });

    await expect(
      handleGenerateContext('job-g', { collectionId: 'col-1', pageIds: ['p1'], userId: 'user-1' }),
    ).rejects.toThrow(/beze změny/);

    expect(mocks.prisma.collection.update).not.toHaveBeenCalled();
  });
});
