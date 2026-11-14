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
  createVersion: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', async () => (await import('./billing-mock')).billingModule());
vi.mock('@ai-sedlacek/db/versioning', () => ({ createVersion: mocks.createVersion }));
vi.mock('../lib/llm', () => ({ createMessage: mocks.createMessage, isCliMode: () => false }));

import { handleFixContexts } from '../handlers/fix-contexts';
import {
  billing,
  blockReservationsByOtherHolds,
  charges,
  refuseReservations,
  resetBillingMock,
} from './billing-mock';
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
  resetBillingMock();
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
    expect(charges().map((c) => c.referenceId)).toEqual([
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

describe('fix-contexts – rezervace kreditu (BIL-1)', () => {
  it('rezervuje před každým voláním; když kredit dojde, zbylé dokumenty nezpracuje', async () => {
    mocks.createMessage.mockResolvedValue(response('Nový kontext', 'end_turn'));
    billing.reserveCredits
      .mockImplementationOnce(
        async (p: { userId: string; amount: number; referenceId: string }) => ({
          ok: true,
          hold: { id: 'h1', userId: p.userId, amount: p.amount, referenceId: p.referenceId },
        }),
      )
      .mockResolvedValueOnce({ ok: false, required: 50_000, available: 100 });

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    // Druhý dokument se k modelu vůbec nedostal
    expect(mocks.createMessage).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.document.update).toHaveBeenCalledTimes(1);
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      currentStep: 'Nedostatečný kredit',
      errors: [expect.stringContaining('1 dokumentů nezpracováno')],
      // Kód pro lokalizovanou hlášku s výzvou k dobití
      errorCode: 'insufficient_credit',
    });
  });

  it('kredit blokovaný jiným jobem: chyba propadne do workeru (credit_busy), model nevolá', async () => {
    blockReservationsByOtherHolds(50_000, 60_000);

    const err: unknown = await handleFixContexts('job-f', {
      collectionId: 'col-1',
      userId: 'user-1',
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: 'insufficient_credit', reserved: 60_000 });
    expect(mocks.createMessage).not.toHaveBeenCalled();
    // Stav a kód chyby (credit_busy) zapíše worker (handleJobFailure)
    expect(
      mocks.prisma.processingJob.update.mock.calls.some(
        (c) => (c[0] as { data: { status?: string } }).data.status === 'error',
      ),
    ).toBe(false);
  });

  it('bez kreditu na první dokument model nezavolá', async () => {
    refuseReservations(0);

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(mocks.createMessage).not.toHaveBeenCalled();
  });
});
