import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review 2026-10: useknutý nebo odmítnutý výstup nesmí přepsat kontext dokumentu
// (nález 3) a závěrečný zápis errors zachová značky reclaimu (nález 6).

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { update: vi.fn(), findUnique: vi.fn() },
    collection: { findUnique: vi.fn() },
    document: { update: vi.fn() },
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

import { handleFixContexts } from '../handlers/fix-contexts';
import { RECLAIM_MARKER } from '../lib/reclaim';

function response(text: string, stopReason: string): Record<string, unknown> {
  return { text, model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 2048, stopReason };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.processingJob.findUnique.mockResolvedValue({ status: 'running', errors: [] });
  mocks.prisma.document.update.mockResolvedValue({});
  mocks.prisma.collection.findUnique.mockResolvedValue({
    id: 'col-1',
    userId: 'user-1',
    name: 'Svazek',
    context: 'Kontext svazku',
    pages: [
      { document: { id: 'doc-1', context: 'starý kontext 1', transcription: 't1' } },
      { document: { id: 'doc-2', context: 'starý kontext 2', transcription: 't2' } },
    ],
  });
  mocks.deductTokensIfSufficient.mockResolvedValue({ success: true, balance: 1000 });
  mocks.createVersion.mockResolvedValue(undefined);
});

describe('fix-contexts – neúplný výstup modelu', () => {
  it('useknutý kontext neuloží (ale naúčtuje), ostatní dokumenty opraví', async () => {
    mocks.createMessage
      .mockResolvedValueOnce(response('Useknutý kont', 'max_tokens'))
      .mockResolvedValueOnce(response('Nový kontext 2', 'end_turn'));

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    // doc-1 beze změny, doc-2 opraven
    expect(mocks.prisma.document.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-2' },
      data: { context: 'Nový kontext 2' },
    });
    expect(mocks.createVersion).toHaveBeenCalledTimes(1);
    expect(mocks.createVersion.mock.calls[0]![0]).toBe('doc-2');
    // Obě volání se naúčtují
    expect(mocks.deductTokensIfSufficient.mock.calls.map((c) => c[4])).toEqual([
      'fix-context:job-f:doc-1',
      'fix-context:job-f:doc-2',
    ]);
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'completed',
      errors: [expect.stringMatching(/^Dokument doc-1: .*beze změny/)],
    });
  });

  it('odmítnutí u všech dokumentů: job skončí chybou, značky reclaimu zůstanou', async () => {
    const marker = `${RECLAIM_MARKER} (obnova 1/2)`;
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      status: 'running',
      errors: [marker],
    });
    mocks.createMessage.mockResolvedValue(response('', 'refusal'));

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(mocks.prisma.document.update).not.toHaveBeenCalled();
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.status).toBe('error');
    expect(lastJobUpdate.data.errors[0]).toBe(marker);
    expect(lastJobUpdate.data.errors).toHaveLength(3);
  });
});
