import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review 2026-10: retranslace nesmí přepsat ruční úpravu překladu provedenou
// během běhu jobu (nález 4) ani uložit useknutý/odmítnutý výstup (nález 3).

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { update: vi.fn() },
    document: { findUnique: vi.fn(), update: vi.fn() },
    translation: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    documentVersion: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  createMessage: vi.fn(),
  deductTokensIfSufficient: vi.fn(),
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', () => ({
  deductTokensIfSufficient: mocks.deductTokensIfSufficient,
}));
vi.mock('../lib/llm', () => ({ createMessage: mocks.createMessage, isCliMode: () => false }));

import { handleRetranslate, TRANSLATION_CHANGED_MESSAGE } from '../handlers/retranslate';

const JOB = { documentId: 'doc-1', language: 'cs', userId: 'user-1' };

/** Překlad v DB na začátku jobu (snapshot) a v okamžiku ukládání. */
function setup(opts: { atStart: string | null; atSave: string | null }): void {
  mocks.prisma.document.findUnique.mockResolvedValue({
    id: 'doc-1',
    transcription: 'upravená transkripce',
    translations: opts.atStart === null ? [] : [{ language: 'cs', text: opts.atStart }],
    page: { userId: 'user-1', collection: null },
  });
  mocks.prisma.translation.findUnique.mockResolvedValue(
    opts.atSave === null ? null : { text: opts.atSave },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.document.update.mockResolvedValue({});
  mocks.prisma.translation.create.mockResolvedValue({});
  mocks.prisma.translation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.documentVersion.findFirst.mockResolvedValue({ version: 7 });
  mocks.prisma.documentVersion.create.mockResolvedValue({});
  // Klientem transakce je přímo mock prismy
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(mocks.prisma),
  );
  mocks.deductTokensIfSufficient.mockResolvedValue({ success: true, balance: 1000 });
  mocks.createMessage.mockResolvedValue({
    text: 'nový překlad',
    model: 'claude-sonnet-4-6',
    inputTokens: 100,
    outputTokens: 50,
    stopReason: 'end_turn',
  });
});

describe('retranslate – souběžná ruční úprava překladu', () => {
  it('překlad mezitím ručně upravený: výsledek neuloží, job skončí chybou, spotřebu naúčtuje', async () => {
    setup({ atStart: 'starý překlad', atSave: 'ruční úprava uživatele' });

    await expect(handleRetranslate('job-r', JOB)).rejects.toThrow(TRANSLATION_CHANGED_MESSAGE);

    expect(mocks.prisma.translation.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.translation.create).not.toHaveBeenCalled();
    expect(mocks.prisma.translation.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.documentVersion.create).not.toHaveBeenCalled();
    expect(mocks.prisma.document.update).not.toHaveBeenCalled();
    expect(mocks.deductTokensIfSufficient).toHaveBeenCalledWith(
      'user-1',
      100,
      50,
      expect.any(String),
      'retranslate:job-r:doc-1:cs',
      'claude-sonnet-4-6',
    );
    // Job se neoznačí jako dokončený
    expect(mocks.prisma.processingJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('beze změny: verzuje aktuální text a přepíše ho podmíněně', async () => {
    setup({ atStart: 'starý překlad', atSave: 'starý překlad' });

    await handleRetranslate('job-r', {
      ...JOB,
      // Text z klienta jde jen do promptu – verzuje se stav z DB
      previousTranslation: 'zastaralý text z klienta',
    });

    expect(mocks.prisma.documentVersion.create).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-1',
        version: 8,
        field: 'translation:cs',
        content: 'starý překlad',
        source: 'ai_retranslate',
        model: 'claude-sonnet-4-6',
      },
    });
    expect(mocks.prisma.translation.updateMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1', language: 'cs', text: 'starý překlad' },
      data: {
        text: 'nový překlad',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      },
    });
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { updatedAt: expect.any(Date) },
      select: { id: true },
    });
    expect(mocks.prisma.processingJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-r' },
      data: expect.objectContaining({ status: 'completed' }),
    });
  });

  it('změna mezi čtením a zápisem (podmíněný update nic nenajde) = konflikt', async () => {
    setup({ atStart: 'starý překlad', atSave: 'starý překlad' });
    mocks.prisma.translation.updateMany.mockResolvedValue({ count: 0 });

    await expect(handleRetranslate('job-r', JOB)).rejects.toThrow(TRANSLATION_CHANGED_MESSAGE);
  });

  it('bez překladu na začátku založí nový; mezitím založený překlad je konflikt', async () => {
    setup({ atStart: null, atSave: null });
    await handleRetranslate('job-r', JOB);
    expect(mocks.prisma.translation.create).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-1',
        language: 'cs',
        text: 'nový překlad',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      },
    });
    expect(mocks.prisma.documentVersion.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(mocks.prisma),
    );
    mocks.deductTokensIfSufficient.mockResolvedValue({ success: true, balance: 1000 });
    setup({ atStart: null, atSave: 'překlad uložený uživatelem' });
    await expect(handleRetranslate('job-r', JOB)).rejects.toThrow(TRANSLATION_CHANGED_MESSAGE);
    expect(mocks.prisma.translation.create).not.toHaveBeenCalled();
  });

  it('kolize čísla verze (P2002) zopakuje celou transakci', async () => {
    setup({ atStart: 'starý překlad', atSave: 'starý překlad' });
    mocks.prisma.documentVersion.create
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
      .mockResolvedValue({});

    await handleRetranslate('job-r', JOB);

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.translation.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('retranslate – neúplný výstup modelu', () => {
  it.each(['max_tokens', 'refusal'])(
    'stop_reason %s: překlad neuloží, spotřebu naúčtuje',
    async (stopReason) => {
      setup({ atStart: 'starý překlad', atSave: 'starý překlad' });
      mocks.createMessage.mockResolvedValue({
        text: 'useknutý překl',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 8192,
        stopReason,
      });

      await expect(handleRetranslate('job-r', JOB)).rejects.toThrow(/beze změny/);

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(mocks.prisma.translation.updateMany).not.toHaveBeenCalled();
      expect(mocks.deductTokensIfSufficient).toHaveBeenCalledTimes(1);
    },
  );
});
