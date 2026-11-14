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

import { FIX_CONTEXT_SKIPPED_NOTE, handleFixContexts } from '../handlers/fix-contexts';
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
      // Nic neslibuje pokračování: kolik je opraveno a že nové spuštění opraví vše
      errors: [
        expect.stringMatching(
          /opraveno 1 z 2 dokumentů; nové spuštění opraví všechny dokumenty svazku znovu$/,
        ),
      ],
      // Počet opravených dokumentů pro hlášku v UI
      completedPages: 1,
      // Kód pro lokalizovanou hlášku s výzvou k dobití
      errorCode: 'insufficient_credit',
    });
  });

  it('kredit blokovaný jiným jobem: job skončí credit_busy s počtem opravených, model nevolá', async () => {
    blockReservationsByOtherHolds(50_000, 60_000);

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(mocks.createMessage).not.toHaveBeenCalled();
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'error',
      errorCode: 'credit_busy',
      currentStep: 'Kredit rezervovaný jiným zpracováním',
      completedPages: 0,
      errors: [
        expect.stringMatching(
          /^Kredit je dočasně rezervovaný.*opraveno 0 z 2 dokumentů; nové spuštění opraví všechny dokumenty svazku znovu$/,
        ),
      ],
    });
  });

  it('bez kreditu na první dokument model nezavolá', async () => {
    refuseReservations(0);

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(mocks.createMessage).not.toHaveBeenCalled();
  });
});

// Review 3. kolo: reclaim spustí job znovu se stejným jobId – dokumenty, za které
// už zaplatil, se nesmí volat znovu (vyúčtování by nic neodečetlo, platil by provozovatel)
describe('fix-contexts – opakovaný běh po reclaimu', () => {
  it('přeskočí dokumenty zaplacené v přerušeném běhu, ostatní opraví', async () => {
    billing.chargedReferenceIds.mockResolvedValue(new Set(['fix-context:job-f:doc-1']));
    mocks.createMessage.mockResolvedValue(response('Nový kontext 2', 'end_turn'));

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(billing.chargedReferenceIds).toHaveBeenCalledWith('user-1', 'fix-context:job-f:');
    // Model jen pro doc-2
    expect(mocks.createMessage).toHaveBeenCalledTimes(1);
    expect(charges().map((c) => c.referenceId)).toEqual(['fix-context:job-f:doc-2']);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-2' },
      data: { context: 'Nový kontext 2' },
    });
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data).toMatchObject({
      status: 'completed',
      completedPages: 2,
      // Poznámka, ať se z prvního běhu neztratí případná chyba
      errors: [`Dokument doc-1: ${FIX_CONTEXT_SKIPPED_NOTE}`],
    });
  });

  it('vše zaplacené už dřív: model nevolá, job neskončí chybou', async () => {
    billing.chargedReferenceIds.mockResolvedValue(
      new Set(['fix-context:job-f:doc-1', 'fix-context:job-f:doc-2']),
    );

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(charges()).toEqual([]);
    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    expect(lastJobUpdate.data.status).toBe('completed');
    expect(lastJobUpdate.data.errors).toHaveLength(2);
  });

  it('přeskočený dokument se nepočítá jako úspěch: chyba u zbytku = job error', async () => {
    billing.chargedReferenceIds.mockResolvedValue(new Set(['fix-context:job-f:doc-1']));
    mocks.createMessage.mockResolvedValue(response('', 'refusal'));

    await handleFixContexts('job-f', { collectionId: 'col-1', userId: 'user-1' });

    const lastJobUpdate = mocks.prisma.processingJob.update.mock.calls.at(-1)![0];
    // doc-1 přeskočen (není úspěch), doc-2 odmítnut → v tomto běhu nic opraveno
    expect(lastJobUpdate.data.status).toBe('error');
    expect(lastJobUpdate.data.errors).toEqual([
      `Dokument doc-1: ${FIX_CONTEXT_SKIPPED_NOTE}`,
      expect.stringMatching(/^Dokument doc-2: .*beze změny/),
    ]);
  });
});
