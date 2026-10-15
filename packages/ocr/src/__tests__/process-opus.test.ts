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
      category: 'bio',
    });
    // Bez usage.iterations (žádný fallback neproběhl) nejsou další pokusy
    expect((err as OcrRefusalError).declinedAttempts).toEqual([]);
  });
});

// Serverový fallback: top-level usage pokrývá jen pokus, který vrátil zprávu –
// spotřebu odmítnutých pokusů nese usage.iterations.
describe('server-side fallback – usage of declined attempts', () => {
  function iteration(
    type: 'message' | 'fallback_message',
    model: string | null,
    input: number,
    output: number,
  ): Record<string, unknown> {
    return {
      type,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
  }

  it('returns the declined attempt of the requested model next to the fallback answer', async () => {
    const jsonl = JSON.stringify({ imageIndex: 0, ...JSON.parse(OCR_JSON) });
    mocks.stream.mockReturnValue(
      fakeStream(
        message({
          model: 'claude-opus-5',
          usage: {
            input_tokens: 3100,
            output_tokens: 2500,
            iterations: [
              // Požadovaný model odmítl uprostřed výstupu (model: null = požadovaný)
              iteration('message', null, 3000, 420),
              iteration('fallback_message', 'claude-opus-5', 3100, 2500),
            ],
          },
          content: [
            { type: 'text', text: 'částečný výstup' },
            {
              type: 'fallback',
              from: { model: 'claude-opus-5-5' },
              to: { model: 'claude-opus-5' },
              trigger: { type: 'refusal', category: 'bio' },
            },
            { type: 'text', text: jsonl },
          ],
        }),
        [jsonl],
      ),
    );

    const res = await processWithClaudeBatch(
      [{ buffer: Buffer.from('a'), pageId: 'p1', index: 0 }],
      'Přepiš.',
    );

    // Top-level usage = odpověď fallback modelu
    expect(res.model).toBe('claude-opus-5');
    expect([res.inputTokens, res.outputTokens]).toEqual([3100, 2500]);
    expect(res.results).toHaveLength(1);
    // Odmítnutý pokus zvlášť, s požadovaným modelem a kategorií z bloku fallback
    expect(res.declinedAttempts).toEqual([
      { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 420, category: 'bio' },
    ]);
  });

  it('without fallback there are no declined attempts', async () => {
    mocks.stream.mockReturnValue(
      fakeStream(
        message({
          usage: {
            input_tokens: 3000,
            output_tokens: 2500,
            iterations: [iteration('message', null, 3000, 2500)],
          },
        }),
      ),
    );

    const res = await processWithClaude(Buffer.from('x'), 'Přepiš text.');

    expect(res.declinedAttempts).toEqual([]);
  });

  it('refusal of the whole chain: usage = last attempt, earlier attempts as declined', async () => {
    mocks.stream.mockReturnValue(
      fakeStream(
        message({
          model: 'claude-opus-5',
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'bio', explanation: null },
          usage: {
            input_tokens: 3100,
            output_tokens: 30,
            iterations: [
              iteration('message', null, 3000, 0),
              iteration('fallback_message', 'claude-opus-5', 3100, 30),
            ],
          },
          content: [
            {
              type: 'fallback',
              from: { model: 'claude-opus-5-5' },
              to: { model: 'claude-opus-5' },
              trigger: { type: 'refusal', category: 'cyber' },
            },
          ],
        }),
      ),
    );

    const err = await processWithClaudeBatch(
      [{ buffer: Buffer.from('a'), pageId: 'p1', index: 0 }],
      'Přepiš.',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrRefusalError);
    const refusal = err as OcrRefusalError;
    // Poslední pokus: kategorie ze stop_details
    expect(refusal.usage).toEqual({
      model: 'claude-opus-5',
      inputTokens: 3100,
      outputTokens: 30,
      category: 'bio',
    });
    // Odmítnutí před výstupem se vrací taky (s kategorií hopu) – o účtování
    // rozhoduje volající
    expect(refusal.declinedAttempts).toEqual([
      { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 0, category: 'cyber' },
    ]);
  });
});
