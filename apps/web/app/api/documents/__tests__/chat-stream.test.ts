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

// ── Mocks ────────────────────────────────────────────────

const mockDocumentFindUnique = vi.fn();
const mockDeduct = vi.fn();
const mockPrepareImage = vi.fn();
const mockWithSharpLimit = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: { findUnique: (...args: unknown[]) => mockDocumentFindUnique(...args) },
  },
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: vi.fn().mockResolvedValue({ balance: 1000, sufficient: true }),
  deductTokensIfSufficient: (...args: unknown[]) => mockDeduct(...args),
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

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => {
        fake = new FakeMessageStream();
        return fake;
      },
    };
  },
}));

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
    page: { imageUrl: '/uploads/scan.jpg', mimeType: 'image/jpeg', userId: 'user-1' },
  });
  mockDeduct.mockResolvedValue({ success: true, balance: 900 });
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
      expect.stringMatching(/^chat-doc-1-/),
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
      expect.stringMatching(/^chat-doc-1-/),
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

    expect(events.at(-1)).toEqual({ type: 'error', error: 'Overloaded' });
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

    expect(events).toEqual([{ type: 'error', error: 'invalid_request_error' }]);
    expect(mockDeduct).not.toHaveBeenCalled();
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

    expect(events.at(-1)).toEqual({ type: 'error', error: 'DB down' });
    expect(mockDeduct).toHaveBeenCalledTimes(1);
  });
});
