import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dva joby téhož uživatele: druhý narazí na rezervaci prvního, i když by mu
// zůstatek sám stačil. Nesmí skončit chybou – vrátí se do fronty s odkladem.

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    page: { updateMany: vi.fn() },
  },
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', async () => (await import('./billing-mock')).billingModule());

import {
  CreditBusyError,
  CREDIT_WAIT_EXHAUSTED_MESSAGE,
  MAX_CREDIT_WAITS,
  creditWaitDelayMs,
  isCreditBusy,
  requeueForCredit,
} from '../lib/credit-wait';
import { handleJobFailure } from '../lib/job-failure';
import { billing } from './billing-mock';

const OCR_JOB = { id: 'job-1', type: 'ocr', pageIds: ['p1', 'p2'] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.processingJob.findUnique.mockResolvedValue({ creditWaits: 0, status: 'running' });
  mocks.prisma.processingJob.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.page.updateMany.mockResolvedValue({ count: 0 });
});

describe('isCreditBusy', () => {
  it('kredit blokovaný jinými rezervacemi, zůstatek by stačil → čekat', () => {
    const err = new billing.InsufficientCreditError(500, 100, 900, 800);
    expect(isCreditBusy(err)).toBe(true);
    expect(isCreditBusy(new CreditBusyError({ required: 1, balance: 2, reserved: 1 }))).toBe(true);
  });

  it('skutečný nedostatek → nečekat', () => {
    expect(isCreditBusy(new billing.InsufficientCreditError(500, 100, 100, 0))).toBe(false);
    expect(isCreditBusy(new billing.InsufficientCreditError(500, 100, 400, 300))).toBe(false);
    expect(isCreditBusy(new Error('jiná chyba'))).toBe(false);
  });
});

describe('creditWaitDelayMs', () => {
  it('backoff 15 s, 30 s, 1 min … nejvýš 5 min', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(creditWaitDelayMs)).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ]);
  });
});

describe('requeueForCredit', () => {
  it('vrátí běžící job do fronty s odkladem a zvýší počítadlo', async () => {
    mocks.prisma.processingJob.findUnique.mockResolvedValue({ creditWaits: 2, status: 'running' });
    const before = Date.now();

    expect(await requeueForCredit('job-1')).toBe(true);

    const call = mocks.prisma.processingJob.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'job-1', status: 'running' });
    expect(call.data).toMatchObject({ status: 'queued', creditWaits: { increment: 1 } });
    const delay = (call.data.notBefore as Date).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(60_000 - 50);
    expect(delay).toBeLessThan(60_000 + 1000);
  });

  it('po vyčerpání odkladů už job nevrací', async () => {
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      creditWaits: MAX_CREDIT_WAITS,
      status: 'running',
    });
    expect(await requeueForCredit('job-1')).toBe(false);
    expect(mocks.prisma.processingJob.updateMany).not.toHaveBeenCalled();
  });
});

describe('handleJobFailure', () => {
  it('kredit blokovaný jiným jobem: odklad ve frontě, žádná chyba ani reset stránek', async () => {
    const result = await handleJobFailure(
      OCR_JOB,
      new CreditBusyError({ required: 500, balance: 900, reserved: 800 }),
    );

    expect(result).toBe('requeued');
    expect(mocks.prisma.processingJob.update).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).not.toHaveBeenCalled();
  });

  it('i textový job (InsufficientCreditError z rezervace) se odloží', async () => {
    const result = await handleJobFailure(
      { id: 'job-r', type: 'retranslate', pageIds: [] },
      new billing.InsufficientCreditError(120_000, 10_000, 200_000, 190_000),
    );
    expect(result).toBe('requeued');
  });

  it('po vyčerpání odkladů skončí chybou insufficient_credit a stránky se vrátí', async () => {
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      creditWaits: MAX_CREDIT_WAITS,
      status: 'running',
    });

    const result = await handleJobFailure(
      OCR_JOB,
      new CreditBusyError({ required: 500, balance: 900, reserved: 800 }),
    );

    expect(result).toBe('failed');
    expect(mocks.prisma.processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'error',
        errorCode: 'insufficient_credit',
        errors: { push: CREDIT_WAIT_EXHAUSTED_MESSAGE },
      }),
    });
    expect(mocks.prisma.page.updateMany).toHaveBeenCalled();
  });

  it('skutečný nedostatek kreditu: chyba insufficient_credit bez odkladu', async () => {
    const result = await handleJobFailure(
      { id: 'job-r', type: 'retranslate', pageIds: [] },
      new billing.InsufficientCreditError(120_000, 10_000, 10_000, 0),
    );

    expect(result).toBe('failed');
    expect(mocks.prisma.processingJob.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.processingJob.update.mock.calls[0]![0].data.errorCode).toBe(
      'insufficient_credit',
    );
  });
});
