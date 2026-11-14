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

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  return {
    default: class {
      static APIError = actual.default.APIError;
      messages = { create: (...args: unknown[]) => mockCreate(...args) };
    },
  };
});

import { POST } from '@/app/api/collections/[id]/fetch-context/route';
import { LLM_MAX_TOKENS, TEXT_MODEL, reservationCredits } from '@ai-sedlacek/shared';

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

  // Druhé volání (metadata z uloženého kontextu, na pozadí) – také s rezervací
  describe('metadata z nového kontextu', () => {
    it('rezervuje s limitem contextMetadata a vyúčtuje s modelem z odpovědi a svazkem', async () => {
      mockCreate
        .mockResolvedValueOnce({
          ...(modelResponse('end_turn', '# Kontext') as object),
          model: 'claude-sonnet-4-6',
        })
        .mockResolvedValueOnce({
          model: 'claude-sonnet-4-6-20261001',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"title": "Kronika"}' }],
          usage: { input_tokens: 300, output_tokens: 40 },
        });

      const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(mockCharges).toHaveBeenCalledTimes(2));
      const [reserve, charges] = mockCharges.mock.calls[1]!;
      expect(reserve).toMatchObject({
        userId: 'user-1',
        referenceId: expect.stringMatching(/^fetch-context-metadata:col-1:/),
      });
      expect(reserve.amount).toBeGreaterThanOrEqual(
        reservationCredits([TEXT_MODEL], 0, LLM_MAX_TOKENS.contextMetadata),
      );
      expect(mockCreate.mock.calls[1]![0]).toMatchObject({
        max_tokens: LLM_MAX_TOKENS.contextMetadata,
      });
      expect(charges).toEqual([
        expect.objectContaining({
          referenceId: reserve.referenceId,
          model: 'claude-sonnet-4-6-20261001',
          inputTokens: 300,
          outputTokens: 40,
          collectionId: 'col-1',
        }),
      ]);
      await vi.waitFor(() =>
        expect(mockCollectionUpdate).toHaveBeenCalledWith({
          where: { id: 'col-1' },
          data: expect.objectContaining({ title: 'Kronika' }),
        }),
      );
    });

    it('bez kreditu na metadata se uložený kontext nemění a metadata se přeskočí', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCreate.mockResolvedValueOnce(modelResponse('end_turn', '# Kontext'));
      mockRunBilledCall
        .mockImplementationOnce(
          async (
            reserve: unknown,
            call: () => Promise<unknown>,
            usage: (r: unknown) => unknown[],
          ) => {
            const result = await call();
            mockCharges(reserve, usage(result));
            return { result, billing: { ok: true } };
          },
        )
        .mockRejectedValueOnce(new FakeInsufficientCreditError(20_000, 0));

      const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(mockRunBilledCall).toHaveBeenCalledTimes(2));
      // Jen jedno volání modelu (kontext) a jen jeden zápis do svazku (kontext)
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCollectionUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it('chyba Claude API: klient dostane lokalizovanou hlášku bez textu SDK', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    mockCreate.mockRejectedValue(
      new Anthropic.APIError(
        529,
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        '529 {"type":"error","error":{"type":"overloaded_error"}}',
        new Headers(),
      ),
    );

    const res = await POST(makeRequest({ text: 'Text z katalogu knihovny' }), ctx);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Služba AI vrátila chybu (529) – zkuste to prosím znovu.');
    expect(body.error).not.toContain('overloaded_error');
  });
});
