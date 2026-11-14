import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { update: vi.fn() },
    page: { updateMany: vi.fn() },
  },
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));
vi.mock('@ai-sedlacek/db/billing', async () => (await import('./billing-mock')).billingModule());

import {
  JobError,
  creditBusyError,
  describeJobError,
  isCreditBusy,
  pageErrorMessage,
} from '../lib/job-error';
import { handleJobFailure } from '../lib/job-failure';
import { billing } from './billing-mock';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.page.updateMany.mockResolvedValue({ count: 0 });
});

describe('describeJobError – kód chyby jobu pro lokalizaci v UI', () => {
  it('JobError předá svůj kód i text', () => {
    expect(describeJobError(new JobError('translation_changed', 'Překlad byl upraven'))).toEqual({
      code: 'translation_changed',
      message: 'Překlad byl upraven',
    });
  });

  it('skutečný nedostatek kreditu → insufficient_credit', () => {
    const err = new billing.InsufficientCreditError(500_000, 1000, 1000, 0);
    expect(describeJobError(err)).toMatchObject({ code: 'insufficient_credit' });
    expect(isCreditBusy(err)).toBe(false);
  });

  it('kredit blokovaný jinou běžící akcí (zůstatek by stačil) → credit_busy', () => {
    const err = new billing.InsufficientCreditError(500_000, 100_000, 900_000, 800_000);
    const described = describeJobError(err);
    expect(described.code).toBe('credit_busy');
    expect(described.message).toMatch(/dočasně rezervovaný jiným běžícím zpracováním/);
    expect(isCreditBusy(err)).toBe(true);
    expect(
      isCreditBusy(creditBusyError({ required: 1, available: 0, balance: 2, reserved: 2 })),
    ).toBe(true);
  });

  it('chyba API: do jobu jde obecný text se stavem, ne surová zpráva SDK', () => {
    const err = new Anthropic.APIError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      new Headers(),
    );
    const described = describeJobError(err);
    expect(described.code).toBe('api_error');
    expect(described.message).toBe('Chyba služby Claude API 529 – zkuste to znovu');
  });

  it('výpadek spojení s API je také api_error', () => {
    const err = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(describeJobError(err).code).toBe('api_error');
  });

  it('ostatní chyby jsou unknown s původním textem', () => {
    expect(describeJobError(new Error('něco'))).toEqual({ code: 'unknown', message: 'něco' });
    expect(describeJobError('x')).toEqual({ code: 'unknown', message: 'Neznámá chyba' });
  });
});

describe('pageErrorMessage – hláška stránky bez surových chyb', () => {
  it('vlastní chyba se známým kódem projde, surová chyba DB/SDK ne', () => {
    expect(pageErrorMessage(new JobError('output_truncated', 'Useknuto'), 'obecná')).toBe(
      'Useknuto',
    );
    expect(pageErrorMessage(new Error('Invalid `prisma.x()` invocation'), 'obecná')).toBe('obecná');
    expect(
      pageErrorMessage(new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'obecná'),
    ).toBe('Chyba služby Claude API – zkuste to znovu');
  });

  it('nedostatek kreditu bez částek', () => {
    const msg = pageErrorMessage(new billing.InsufficientCreditError(500_000, 10), 'obecná');
    expect(msg).toBe('Nedostatečný kredit – stránka nebyla zpracována');
  });
});

describe('handleJobFailure – rychlé selhání bez odkladu', () => {
  const OCR_JOB = { id: 'job-1', type: 'ocr', pageIds: ['p1', 'p2'] };

  it('kredit blokovaný jinou akcí: error s kódem credit_busy a stránky zpět do pending', async () => {
    await handleJobFailure(
      OCR_JOB,
      new billing.InsufficientCreditError(500_000, 100_000, 900_000, 800_000),
    );

    expect(mocks.prisma.processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'error', errorCode: 'credit_busy' }),
    });
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });

  it('textový job se skutečným nedostatkem: insufficient_credit, stránky se neřeší', async () => {
    await handleJobFailure(
      { id: 'job-r', type: 'retranslate', pageIds: [] },
      new billing.InsufficientCreditError(120_000, 10_000, 10_000, 0),
    );

    expect(mocks.prisma.processingJob.update.mock.calls[0]![0].data).toMatchObject({
      status: 'error',
      errorCode: 'insufficient_credit',
    });
    expect(mocks.prisma.page.updateMany).not.toHaveBeenCalled();
  });
});
