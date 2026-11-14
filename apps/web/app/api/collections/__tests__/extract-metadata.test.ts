import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { LLM_MAX_TOKENS, TEXT_MODEL, reservationCredits } from '@ai-sedlacek/shared';

// Účtování POST /api/collections/[id]/extract-metadata (BIL-1/BIL-11): rezervace
// před voláním modelu, vyúčtování skutečné spotřeby s modelem z odpovědi
// a svazkem – i když se odpověď nepodaří naparsovat.

const mockCollectionFindUnique = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCreate = vi.fn();
const mockRunBilledCall = vi.fn();
const mockCharges = vi.fn();

const { FakeInsufficientCreditError } = vi.hoisted(() => ({
  FakeInsufficientCreditError: class extends Error {
    constructor(
      readonly required: number,
      readonly available: number,
    ) {
      super('insufficient');
    }
  },
}));

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: {
      findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args),
      update: (...args: unknown[]) => mockCollectionUpdate(...args),
    },
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  InsufficientCreditError: FakeInsufficientCreditError,
  runBilledCall: (...args: unknown[]) => mockRunBilledCall(...args),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  return {
    default: class {
      static APIError = actual.default.APIError;
      messages = { create: (...args: unknown[]) => mockCreate(...args) };
    },
  };
});

import { POST } from '@/app/api/collections/[id]/extract-metadata/route';

const ctx = { params: Promise.resolve({ id: 'col-1' }) };

function request(): NextRequest {
  return new NextRequest('http://localhost/api/collections/col-1/extract-metadata', {
    method: 'POST',
    headers: { 'x-locale': 'cs' },
  });
}

function modelResponse(text: string): unknown {
  return {
    model: 'claude-sonnet-4-6-20261001',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 700, output_tokens: 90 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectionFindUnique.mockResolvedValue({
    id: 'col-1',
    userId: 'user-1',
    name: 'Kronika',
    context: '# Kronika města\\n\\nRukopis z 15. století.',
  });
  mockCollectionUpdate.mockResolvedValue({});
  // Průchozí rezervace: zavolá model a zaznamená rezervaci a vyúčtované položky
  mockRunBilledCall.mockImplementation(
    async (reserve: unknown, call: () => Promise<unknown>, usage: (r: unknown) => unknown[]) => {
      const result = await call();
      mockCharges(reserve, usage(result));
      return { result, billing: { ok: true } };
    },
  );
});

describe('POST /api/collections/[id]/extract-metadata – účtování', () => {
  it('bez volného kreditu vrátí 402 a model nezavolá', async () => {
    mockRunBilledCall.mockRejectedValue(new FakeInsufficientCreditError(30_000, 100));

    const res = await POST(request(), ctx);

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'insufficient_credit', required: 30_000 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
  });

  it('rezervuje s limitem contextMetadata a model volá se stejným max_tokens', async () => {
    mockCreate.mockResolvedValue(modelResponse('{"title": "Kronika"}'));

    await POST(request(), ctx);

    const [reserve] = mockCharges.mock.calls[0]!;
    expect(reserve).toMatchObject({
      userId: 'user-1',
      referenceId: expect.stringMatching(/^extract-metadata:col-1:/),
    });
    expect(reserve.amount).toBeGreaterThanOrEqual(
      reservationCredits([TEXT_MODEL], 0, LLM_MAX_TOKENS.contextMetadata),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: LLM_MAX_TOKENS.contextMetadata }),
    );
  });

  it('vyúčtuje skutečnou spotřebu s modelem z odpovědi a svazkem', async () => {
    mockCreate.mockResolvedValue(modelResponse('{"title": "Kronika", "yearFrom": 1450}'));

    const res = await POST(request(), ctx);

    expect(res.status).toBe(200);
    const [reserve, charges] = mockCharges.mock.calls[0]!;
    expect(charges).toEqual([
      {
        referenceId: reserve.referenceId,
        description: 'Metadata svazku Kronika',
        model: 'claude-sonnet-4-6-20261001',
        inputTokens: 700,
        outputTokens: 90,
        collectionId: 'col-1',
      },
    ]);
    expect(mockCollectionUpdate).toHaveBeenCalledWith({
      where: { id: 'col-1' },
      data: expect.objectContaining({ title: 'Kronika', yearFrom: 1450 }),
    });
  });

  it('spotřebu vyúčtuje i když odpověď nejde naparsovat', async () => {
    mockCreate.mockResolvedValue(modelResponse('Toto není JSON'));

    const res = await POST(request(), ctx);

    expect(res.status).toBe(500);
    expect(mockCharges).toHaveBeenCalledTimes(1);
    expect(mockCharges.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ inputTokens: 700, outputTokens: 90, collectionId: 'col-1' }),
    ]);
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
  });
});
