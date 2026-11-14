import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// SSE chat nad dokumentem: zavření spojení klientem zastaví generování (cancel →
// abort), zápisy do zavřeného streamu nevyhazují a spotřeba, která už vznikla,
// se naúčtuje (stejnou billing funkcí, modelem z odpovědi).

// ── Fake Anthropic MessageStream ─────────────────────────

interface Snapshot {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

class FakeMessageStream {
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  currentMessage: Snapshot | undefined = undefined;
  aborted = false;
  private resolveFinal!: (msg: unknown) => void;
  private rejectFinal!: (err: unknown) => void;
  private final = new Promise((resolve, reject) => {
    this.resolveFinal = resolve;
    this.rejectFinal = reject;
  });

  on(event: string, cb: (...args: unknown[]) => void): this {
    (this.listeners[event] ??= []).push(cb);
    return this;
  }
  emitText(text: string): void {
    for (const cb of this.listeners.text ?? []) cb(text, '');
  }
  finalMessage(): Promise<unknown> {
    return this.final;
  }
  abort(): void {
    this.aborted = true;
    this.rejectFinal(new Error('Request was aborted.'));
  }
  finish(msg: Snapshot): void {
    this.resolveFinal(msg);
  }
  fail(err: Error): void {
    this.rejectFinal(err);
  }
}

let fake: FakeMessageStream;
const streamParams: unknown[] = [];

// ── Mocks ────────────────────────────────────────────────

const mockDocumentFindUnique = vi.fn();
const mockDeduct = vi.fn();
const mockReserve = vi.fn();
const mockRelease = vi.fn();
const mockChargeCollections = vi.fn();
const mockPrepareImage = vi.fn();
const mockWithSharpLimit = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: { findUnique: (...args: unknown[]) => mockDocumentFindUnique(...args) },
  },
}));

// Vyúčtování rezervace se v testu rozloží na položky ve tvaru dřívějšího odečtu
// (uživatel, vstup, výstup, popis, referenceId, model).
vi.mock('@/lib/infrastructure/billing', () => ({
  reserveCredits: (...args: unknown[]) => mockReserve(...args),
  releaseCreditHold: (...args: unknown[]) => mockRelease(...args),
  settleCreditHold: async (
    hold: { userId: string },
    charges: {
      inputTokens: number;
      outputTokens: number;
      description: string;
      referenceId: string;
      model: string;
      collectionId?: string | null;
    }[],
  ) => {
    mockChargeCollections(charges.map((c) => c.collectionId));
    for (const c of charges) {
      await mockDeduct(
        hold.userId,
        c.inputTokens,
        c.outputTokens,
        c.description,
        c.referenceId,
        c.model,
      );
    }
    return { charged: 0, uncovered: 0, transactions: [] };
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/adapters/storage', () => ({
  getStorage: () => ({ read: vi.fn().mockResolvedValue(Buffer.from('img')) }),
  storageKeyFromImageUrl: (url: string) => url.replace(/^\/uploads\//, ''),
}));

vi.mock('@ai-sedlacek/ocr', () => ({
  prepareImage: (...args: unknown[]) => mockPrepareImage(...args),
}));

vi.mock('@/lib/infrastructure/sharp-limit', () => ({
  withSharpLimit: (fn: () => Promise<unknown>) => mockWithSharpLimit(fn),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  return {
    default: class {
      // Typy chyb SDK zůstávají skutečné (route podle nich volí hlášku)
      static APIError = actual.default.APIError;
      messages = {
        stream: (params: unknown) => {
          streamParams.push(params);
          fake = new FakeMessageStream();
          return fake;
        },
      };
    },
  };
});

import { POST as chat } from '@/app/api/documents/[id]/chat/route';

// ── Helpers ──────────────────────────────────────────────

const ctx = { params: Promise.resolve({ id: 'doc-1' }) };

function post(): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Co tu stojí?' }] }),
    headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
  });
}

const decoder = new TextDecoder();

async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Record<string, unknown>[]> {
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDocumentFindUnique.mockResolvedValue({
    id: 'doc-1',
    transcription: 'Ich bekenne',
    context: '',
    translations: [{ language: 'cs', text: 'Vyznávám' }],
    glossary: [],
    page: {
      imageUrl: '/uploads/scan.jpg',
      mimeType: 'image/jpeg',
      userId: 'user-1',
      collectionId: 'col-1',
    },
  });
  mockDeduct.mockResolvedValue(undefined);
  mockReserve.mockImplementation(
    async (p: { userId: string; amount: number; referenceId: string }) => ({
      ok: true,
      hold: { id: 'hold-1', userId: p.userId, amount: p.amount, referenceId: p.referenceId },
    }),
  );
  mockRelease.mockResolvedValue(true);
  mockPrepareImage.mockResolvedValue({ buffer: Buffer.from('prepared'), mediaType: 'image/jpeg' });
  mockWithSharpLimit.mockImplementation((fn: () => Promise<unknown>) => fn());
});

// ── Tests ────────────────────────────────────────────────

describe('POST /api/documents/[id]/chat – streaming', () => {
  it('prepares the image under the shared sharp semaphore', async () => {
    const res = await chat(post(), ctx);
    fake.finish({ model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 5 } });
    await readEvents(res.body!.getReader());

    expect(mockWithSharpLimit).toHaveBeenCalledTimes(1);
    expect(mockPrepareImage).toHaveBeenCalledTimes(1);
  });

  it('streams text, charges the final usage with the responding model and closes', async () => {
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    fake.emitText('Ahoj');
    fake.finish({ model: 'claude-sonnet-4-6', usage: { input_tokens: 1200, output_tokens: 80 } });
    const events = await readEvents(reader);

    expect(events).toEqual([
      { type: 'text', text: 'Ahoj' },
      {
        type: 'done',
        usage: { inputTokens: 1200, outputTokens: 80, model: 'claude-sonnet-4-6' },
      },
    ]);
    expect(mockDeduct).toHaveBeenCalledTimes(1);
    expect(mockDeduct).toHaveBeenCalledWith(
      'user-1',
      1200,
      80,
      'Chat s dokumentem doc-1',
      expect.stringMatching(/^chat:doc-1:/),
      'claude-sonnet-4-6',
    );
  });

  it('aborts the model stream and charges partial usage when the client disconnects', async () => {
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    // message_start už přišel – vstup známe, výstup zatím jen placeholder.
    fake.currentMessage = {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1500, output_tokens: 1 },
    };
    fake.emitText('x'.repeat(400));
    await reader.read();

    await reader.cancel();
    expect(fake.aborted).toBe(true);

    // Text, který dorazí po zavření, nesmí vyhodit (enqueue do zavřeného streamu).
    expect(() => fake.emitText('pozdě')).not.toThrow();

    await vi.waitFor(() => expect(mockDeduct).toHaveBeenCalledTimes(1));
    // Výstup odhadnutý z odeslaného textu (400 znaků / 4), model ze snapshotu.
    expect(mockDeduct).toHaveBeenCalledWith(
      'user-1',
      1500,
      100,
      'Chat s dokumentem doc-1 (přerušeno)',
      expect.stringMatching(/^chat:doc-1:/),
      'claude-sonnet-4-6',
    );
  });

  it('uses output tokens from the last message_delta when they exceed the estimate', async () => {
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    fake.currentMessage = {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1500, output_tokens: 300 },
    };
    fake.emitText('krátké');
    fake.fail(new Error('Overloaded'));
    const events = await readEvents(reader);

    // Surová zpráva chyby ke klientovi nejde – jen obecná hláška v jazyce UI
    expect(events.at(-1)).toEqual({ type: 'error', error: 'Interní chyba serveru' });
    expect(mockDeduct).toHaveBeenCalledWith(
      'user-1',
      1500,
      300,
      'Chat s dokumentem doc-1 (přerušeno)',
      expect.any(String),
      'claude-sonnet-4-6',
    );
  });

  it('charges nothing when the API fails before message_start', async () => {
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    fake.fail(new Error('invalid_request_error'));
    const events = await readEvents(reader);

    expect(events).toEqual([{ type: 'error', error: 'Interní chyba serveru' }]);
    expect(mockDeduct).not.toHaveBeenCalled();
    // Rezervace bez spotřeby se uvolní (neblokuje kredit do vypršení)
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ id: 'hold-1' }));
  });

  it('does not charge twice when billing of the final message fails', async () => {
    mockDeduct.mockRejectedValue(new Error('DB down'));
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    fake.currentMessage = {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 10, output_tokens: 1 },
    };
    fake.finish({ model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 5 } });
    const events = await readEvents(reader);

    expect(events.at(-1)).toEqual({ type: 'error', error: 'Interní chyba serveru' });
    expect(mockDeduct).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('chyba Claude API jde klientovi jako lokalizovaná hláška se stavem, bez textu SDK', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const res = await chat(post(), ctx);
    const reader = res.body!.getReader();

    fake.fail(
      new Anthropic.APIError(
        529,
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        '529 {"type":"error","error":{"type":"overloaded_error"}}',
        new Headers(),
      ),
    );
    const events = await readEvents(reader);

    expect(events.at(-1)).toEqual({
      type: 'error',
      error: 'Služba AI vrátila chybu (529) – zkuste to prosím znovu.',
    });
  });

  it('calls the model with LLM_MAX_TOKENS.chat (same limit as the reservation)', async () => {
    const { LLM_MAX_TOKENS } = await import('@ai-sedlacek/shared');
    const res = await chat(post(), ctx);
    fake.finish({ model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 5 } });
    await readEvents(res.body!.getReader());
    expect(streamParams.at(-1)).toMatchObject({ max_tokens: LLM_MAX_TOKENS.chat });
  });

  it('reserves the maximum price before calling the model (BIL-1)', async () => {
    const res = await chat(post(), ctx);
    fake.finish({ model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 5 } });
    await readEvents(res.body!.getReader());

    expect(mockReserve).toHaveBeenCalledTimes(1);
    const reserve = mockReserve.mock.calls[0]![0];
    expect(reserve).toMatchObject({
      userId: 'user-1',
      referenceId: expect.stringMatching(/^chat:doc-1:/),
    });
    // 8192 výstupních tokenů Sonnetu 4.6 × $15 za 1M × 23 × 2 / 50 Kč za 1M kreditů ≈ 113 050
    expect(reserve.amount).toBeGreaterThan(113_000);
    // Vyúčtování proběhne s klíčem rezervace
    expect(mockDeduct.mock.calls[0]![4]).toBe(reserve.referenceId);
    // Spotřeba chatu se počítá do ceny svazku dokumentu (BIL-11)
    expect(mockChargeCollections).toHaveBeenCalledWith(['col-1']);
  });

  it('returns 402 without calling the model when the reservation is refused', async () => {
    mockReserve.mockResolvedValue({ ok: false, required: 120_000, available: 500 });
    fake = undefined as unknown as FakeMessageStream;

    const res = await chat(post(), ctx);

    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string; required: number; error: string };
    expect(body).toMatchObject({ code: 'insufficient_credit', required: 120_000 });
    expect(body.error).toContain('120');
    expect(fake).toBeUndefined();
  });
});
