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

import {
  processWithClaude,
  processWithClaudeBatch,
  OcrRefusalError,
  OcrStreamInterruptedError,
  BATCH_OUTPUT_TOKENS_PER_PAGE,
  THINKING_TOKENS_RESERVE,
  partialUsage,
  batchMaxTokens,
  ocrBatchReservationCredits,
} from '../process';
import { MAX_IMAGE_INPUT_TOKENS, OCR_MODEL, creditsForUsage } from '@ai-sedlacek/shared';

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
    expect(res.interrupted).toBe(false);
    expect(res.model).toBe('claude-opus-5');
    expect([res.inputTokens, res.outputTokens]).toEqual([3100, 2500]);
    expect(res.results).toHaveLength(1);
    // Odmítnutý pokus zvlášť, s požadovaným modelem a kategorií z bloku fallback
    expect(res.declinedAttempts).toEqual([
      { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 420, category: 'bio' },
    ]);
  });

  it('tolerates a fallback block without trigger (category unknown)', async () => {
    const jsonl = JSON.stringify({ imageIndex: 0, ...JSON.parse(OCR_JSON) });
    mocks.stream.mockReturnValue(
      fakeStream(
        message({
          model: 'claude-opus-5',
          usage: {
            input_tokens: 3100,
            output_tokens: 2500,
            iterations: [
              iteration('message', null, 3000, 0),
              iteration('fallback_message', 'claude-opus-5', 3100, 2500),
            ],
          },
          content: [
            // Tvar z veřejné dokumentace – bez `trigger`
            {
              type: 'fallback',
              from: { model: 'claude-opus-5-5' },
              to: { model: 'claude-opus-5' },
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

    expect(res.results).toHaveLength(1);
    expect(res.declinedAttempts).toEqual([
      { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 0, category: null },
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

// Stream spadne uprostřed generování (overloaded_error v SSE, reset spojení) –
// vstup i vygenerovaný výstup Anthropic účtuje, spotřeba jde se chybou k volajícímu.
describe('přerušený stream – spotřeba ze snapshotu', () => {
  function failingStream(
    error: Error,
    snapshot: Record<string, unknown> | undefined,
    textDeltas: string[] = [],
  ): unknown {
    return {
      on: (event: string, cb: (text: string) => void) => {
        if (event === 'text') textDeltas.forEach(cb);
      },
      finalMessage: () => Promise.reject(error),
      currentMessage: snapshot,
    };
  }

  it('chyba uprostřed generování: OcrStreamInterruptedError se spotřebou a původní chybou', async () => {
    const overloaded = new Error('overloaded_error');
    const generated = 'x'.repeat(4_001);
    mocks.stream.mockReturnValue(
      failingStream(
        overloaded,
        // Snapshot po message_start: výstupní počítadlo z message_start (1),
        // vygenerovaný text a thinking v content
        message({
          usage: { input_tokens: 3000, output_tokens: 1 },
          content: [
            { type: 'thinking', thinking: 'y'.repeat(399), signature: '' },
            { type: 'text', text: generated },
          ],
        }),
        [generated],
      ),
    );

    const err = await processWithClaude(Buffer.from('x'), 'Přepiš text.').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrStreamInterruptedError);
    const interrupted = err as OcrStreamInterruptedError;
    expect(interrupted.cause).toBe(overloaded);
    // Výstup odhadnutý z vygenerovaných znaků (4 400 / 4), počítadlo API je nižší
    expect(interrupted.usage).toEqual({
      model: 'claude-opus-5-5',
      inputTokens: 3000,
      outputTokens: 1_100,
    });
    // Streamovaný text jde s chybou – zaplacený výstup se nezahazuje
    expect(interrupted.text).toBe(generated);
  });

  it('dávka: přerušení zpracuje jako useknutí – vrátí kompletní stránky se spotřebou', async () => {
    const page0 = JSON.stringify({ imageIndex: 0, ...JSON.parse(OCR_JSON) });
    const page1 = JSON.stringify({ imageIndex: 1, ...JSON.parse(OCR_JSON) });
    // Třetí stránka useknutá uprostřed řádku
    const streamedText = `${page0}\n${page1}\n{"imageIndex": 2, "transcription": "Usek`;
    mocks.stream.mockReturnValue(
      failingStream(
        new Error('overloaded_error'),
        message({
          usage: { input_tokens: 9000, output_tokens: 1 },
          content: [{ type: 'text', text: streamedText }],
        }),
        [streamedText],
      ),
    );

    const res = await processWithClaudeBatch(
      [
        { buffer: Buffer.from('a'), pageId: 'p1', index: 0 },
        { buffer: Buffer.from('b'), pageId: 'p2', index: 1 },
        { buffer: Buffer.from('c'), pageId: 'p3', index: 2 },
      ],
      'Přepiš.',
    );

    expect(res.interrupted).toBe(true);
    expect(res.truncated).toBe(false);
    expect(res.stopReason).toBeNull();
    expect(res.results.map((r) => r.index)).toEqual([0, 1]);
    expect(res.parseProblem).toBeNull();
    expect(res.rawResponse).toBe(streamedText);
    expect([res.model, res.inputTokens, res.outputTokens]).toEqual([
      'claude-opus-5-5',
      9000,
      Math.ceil(streamedText.length / 4),
    ]);
    expect(res.declinedAttempts).toEqual([]);
  });

  it('dávka: odmítnuté pokusy fallbacku ze snapshotu (po message_delta) jdou s výsledkem', async () => {
    mocks.stream.mockReturnValue(
      failingStream(
        new Error('Connection reset'),
        message({
          model: 'claude-opus-5',
          usage: {
            input_tokens: 3100,
            output_tokens: 500,
            iterations: [
              {
                type: 'message',
                model: null,
                input_tokens: 3000,
                output_tokens: 0,
                cache_creation: null,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              {
                type: 'fallback_message',
                model: 'claude-opus-5',
                input_tokens: 3100,
                output_tokens: 500,
                cache_creation: null,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            ],
          },
          content: [
            {
              type: 'fallback',
              from: { model: 'claude-opus-5-5' },
              to: { model: 'claude-opus-5' },
              trigger: { type: 'refusal', category: 'bio' },
            },
            { type: 'text', text: '{"imageIndex": 0, "transcr' },
          ],
        }),
      ),
    );

    const res = await processWithClaudeBatch(
      [{ buffer: Buffer.from('a'), pageId: 'p1', index: 0 }],
      'Přepiš.',
    );

    expect(res.interrupted).toBe(true);
    expect(res.results).toEqual([]);
    expect(res.model).toBe('claude-opus-5');
    expect(res.declinedAttempts).toEqual([
      { model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 0, category: 'bio' },
    ]);
  });

  it('po message_delta má přednost vyšší počítadlo API', async () => {
    mocks.stream.mockReturnValue(
      failingStream(
        new Error('Connection reset'),
        message({
          model: 'claude-opus-5',
          usage: { input_tokens: 3100, output_tokens: 9_000 },
          content: [{ type: 'text', text: 'krátký' }],
        }),
      ),
    );

    const err = await processWithClaude(Buffer.from('x'), 'Přepiš text.').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrStreamInterruptedError);
    expect((err as OcrStreamInterruptedError).usage).toEqual({
      model: 'claude-opus-5',
      inputTokens: 3100,
      outputTokens: 9_000,
    });
  });

  it('stream skončí bez message_stop: spotřeba z posledního snapshotu streamEvent', async () => {
    // SDK při řádném konci spojení bez message_stop snapshot vynuluje
    // (currentMessage undefined) a finalMessage() odmítne
    const ended = new Error('stream ended without producing a Message with role=assistant');
    const snapshot = message({
      usage: { input_tokens: 3000, output_tokens: 1 },
      content: [{ type: 'text', text: 'z'.repeat(800) }],
    });
    mocks.stream.mockReturnValue({
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'streamEvent') cb({ type: 'content_block_delta' }, snapshot);
      },
      finalMessage: () => Promise.reject(ended),
      currentMessage: undefined,
    });

    const err = await processWithClaude(Buffer.from('x'), 'Přepiš text.').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrStreamInterruptedError);
    expect((err as OcrStreamInterruptedError).cause).toBe(ended);
    expect((err as OcrStreamInterruptedError).usage).toEqual({
      model: 'claude-opus-5-5',
      inputTokens: 3000,
      outputTokens: 200,
    });
  });

  it('odhad výstupu nepřekročí max_tokens volání (zacyklené opakování)', async () => {
    // 1 stránka → max_tokens 24 000; 200 000 znaků by dalo odhad 50 000 tokenů
    mocks.stream.mockReturnValue(
      failingStream(
        new Error('overloaded_error'),
        message({
          usage: { input_tokens: 3000, output_tokens: 1 },
          content: [{ type: 'text', text: 'ab'.repeat(100_000) }],
        }),
      ),
    );

    const err = await processWithClaude(Buffer.from('x'), 'Přepiš text.').catch((e: unknown) => e);

    expect((err as OcrStreamInterruptedError).usage.outputTokens).toBe(
      THINKING_TOKENS_RESERVE + BATCH_OUTPUT_TOKENS_PER_PAGE,
    );
  });

  it('partialUsage: max z počítadla API a odhadu, nejvýš max_tokens', () => {
    const snap = (outputTokens: number, text: string) =>
      message({
        usage: { input_tokens: 10, output_tokens: outputTokens },
        content: [{ type: 'text', text }],
      }) as unknown as Parameters<typeof partialUsage>[0];
    expect(partialUsage(snap(1, 'x'.repeat(400)), 1000).outputTokens).toBe(100);
    expect(partialUsage(snap(700, 'x'.repeat(400)), 1000).outputTokens).toBe(700);
    expect(partialUsage(snap(1, 'x'.repeat(40_000)), 1000).outputTokens).toBe(1000);
  });

  it('chyba před prvním eventem (bez snapshotu): původní chyba beze změny', async () => {
    const networkError = new Error('ECONNREFUSED');
    mocks.stream.mockReturnValue(failingStream(networkError, undefined));

    const err = await processWithClaudeBatch(
      [{ buffer: Buffer.from('a'), pageId: 'p1', index: 0 }],
      'Přepiš.',
    ).catch((e: unknown) => e);

    expect(err).toBe(networkError);
  });
});

describe('rezervace kreditu před OCR dávkou (BIL-1)', () => {
  it('pokryje celý max_tokens dávky a obrázky sazbou primárního modelu', () => {
    for (const pages of [1, 3, 6]) {
      const hold = ocrBatchReservationCredits(pages, 'Přepiš text z tohoto rukopisu.');
      const primary = creditsForUsage(
        OCR_MODEL,
        pages * MAX_IMAGE_INPUT_TOKENS,
        batchMaxTokens(pages),
      );
      expect(hold).toBeGreaterThanOrEqual(primary);
    }
  });

  it('nerezervuje sazbou dražšího fallbacku, který nastává jen při odmítnutí', () => {
    // Rozhodnutí 2026-11-14: vzácný přesah při fallbacku (Opus 5 / 4.8, $5/$25)
    // pokryje volný kredit, jinak ho nese provozovatel – kredit nejde do minusu.
    for (const pages of [1, 3, 6]) {
      const hold = ocrBatchReservationCredits(pages, 'Přepiš text z tohoto rukopisu.');
      const fallbackWorstCase = creditsForUsage(
        'claude-opus-5',
        pages * MAX_IMAGE_INPUT_TOKENS,
        batchMaxTokens(pages),
      );
      expect(hold).toBeLessThan(fallbackWorstCase);
    }
  });

  it('roste s počtem stránek a s délkou kontextu', () => {
    expect(ocrBatchReservationCredits(2, '')).toBeGreaterThan(ocrBatchReservationCredits(1, ''));
    expect(ocrBatchReservationCredits(1, 'x'.repeat(20_000))).toBeGreaterThan(
      ocrBatchReservationCredits(1, ''),
    );
  });
});
