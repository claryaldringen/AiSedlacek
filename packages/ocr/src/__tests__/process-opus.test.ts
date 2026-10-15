import { describe, it, expect, vi, beforeEach } from 'vitest';

// Migrace OCR na Opus 5.5: ověřuje tvar požadavku (bez temperature, explicitní
// effort, serverový fallback) a zpracování odpovědi (thinking bloky, refusal).

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  prepareImage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { stream: (...args: unknown[]) => mocks.stream(...args) } };
  },
}));

vi.mock('../prepare-image', () => ({ prepareImage: mocks.prepareImage }));

import { processWithClaude, processWithClaudeBatch, OcrRefusalError } from '../process';

const OCR_JSON = JSON.stringify({
  transcription: 'Text',
  detectedLanguage: 'cs-old',
  translation: 'Překlad',
  translationLanguage: 'cs',
  context: 'Kontext',
  glossary: [],
});

function fakeStream(message: Record<string, unknown>, textDeltas: string[] = []): unknown {
  return {
    on: (event: string, cb: (text: string) => void) => {
      if (event === 'text') textDeltas.forEach(cb);
    },
    finalMessage: () => Promise.resolve(message),
  };
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_1',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 3000, output_tokens: 2500 },
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: OCR_JSON },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepareImage.mockResolvedValue({ buffer: Buffer.from('img'), mediaType: 'image/jpeg' });
});

describe('OCR request on Opus 5.5', () => {
  it('sends no temperature, explicit effort and server-side fallback', async () => {
    mocks.stream.mockReturnValue(fakeStream(message()));

    await processWithClaude(Buffer.from('x'), 'Přepiš text.');

    const params = mocks.stream.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('reads the answer from text blocks, skipping leading thinking blocks', async () => {
    mocks.stream.mockReturnValue(fakeStream(message()));

    const res = await processWithClaude(Buffer.from('x'), 'Přepiš text.');

    expect(res.result.transcription).toBe('Text');
    expect(res.model).toBe('claude-opus-5-5');
  });

  it('reserves max_tokens for thinking in batches', async () => {
    mocks.stream.mockReturnValue(fakeStream(message({ content: [{ type: 'text', text: '' }] })));

    await processWithClaudeBatch(
      [
        { buffer: Buffer.from('a'), pageId: 'p1', index: 0 },
        { buffer: Buffer.from('b'), pageId: 'p2', index: 1 },
      ],
      'Přepiš.',
    );

    const params = mocks.stream.mock.calls[0]![0] as { max_tokens: number };
    expect(params.max_tokens).toBe(16_000 + 2 * 8_000);
  });

  it('throws OcrRefusalError with usage when the model (and fallback) refused', async () => {
    mocks.stream.mockReturnValue(
      fakeStream(
        message({
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'bio', explanation: null },
          usage: { input_tokens: 3000, output_tokens: 12 },
          content: [],
        }),
      ),
    );

    const err = await processWithClaude(Buffer.from('x'), 'Přepiš text.').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrRefusalError);
    expect((err as OcrRefusalError).category).toBe('bio');
    expect((err as OcrRefusalError).usage).toEqual({
      model: 'claude-opus-5-5',
      inputTokens: 3000,
      outputTokens: 12,
    });
  });
});
