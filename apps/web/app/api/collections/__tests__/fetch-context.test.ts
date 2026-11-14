import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockCollectionFindUnique = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCreate = vi.fn();
const mockCharges = vi.fn();
const mockRunBilledCall = vi.fn();

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
  checkBalance: vi.fn().mockResolvedValue({
    balance: 1_000_000,
    reserved: 0,
    available: 1_000_000,
    required: 1,
    sufficient: true,
  }),
  InsufficientCreditError: FakeInsufficientCreditError,
  runBilledCall: (...args: unknown[]) => mockRunBilledCall(...args),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  },
}));

import { POST } from '@/app/api/collections/[id]/fetch-context/route';

// ── Helpers ──────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/collections/col-1/fetch-context', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
  });
}

const ctx = { params: Promise.resolve({ id: 'col-1' }) };

function modelResponse(stopReason: string, text: string): unknown {
  return {
    stop_reason: stopReason,
    content: text ? [{ type: 'text', text }] : [],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('POST /api/collections/[id]/fetch-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionFindUnique.mockResolvedValue({
      id: 'col-1',
      userId: 'user-1',
      context: 'Pečlivě sepsaný původní kontext',
      contextUrls: [],
    });
    mockCollectionUpdate.mockResolvedValue({});
    // Průchozí rezervace: zavolá model a předá vyúčtované položky
    mockRunBilledCall.mockImplementation(
      async (reserve: unknown, call: () => Promise<unknown>, usage: (r: unknown) => unknown[]) => {
        const result = await call();
        mockCharges(reserve, usage(result));
        return { result, billing: { ok: true } };
      },
    );
  });

  it('keeps the existing context when the model output was truncated', async () => {
    mockCreate.mockResolvedValue(modelResponse('max_tokens', '# Useknutý kontext…'));

    const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

    expect(res.status).toBe(422);
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
    // Useknutý výstup se i tak vyúčtuje – spotřeba vznikla
    expect(mockCharges).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', amount: expect.any(Number) }),
      [expect.objectContaining({ inputTokens: 100, outputTokens: 50 })],
    );
  });

  it('returns 402 and keeps the context when free credit cannot cover the reservation', async () => {
    mockRunBilledCall.mockRejectedValue(new FakeInsufficientCreditError(400_000, 1_000));

    const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'insufficient_credit', required: 400_000 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
  });

  it('keeps the existing context when the model returned no text', async () => {
    mockCreate.mockResolvedValue(modelResponse('end_turn', ''));

    const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

    expect(res.status).toBe(422);
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
  });

  it('saves a complete context', async () => {
    mockCreate.mockResolvedValue(modelResponse('end_turn', '# Kontext\n\nKompletní text'));

    const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

    expect(res.status).toBe(200);
    expect(mockCollectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'col-1' },
        data: expect.objectContaining({ context: '# Kontext\n\nKompletní text' }),
      }),
    );
  });
});
