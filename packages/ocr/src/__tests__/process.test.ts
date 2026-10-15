import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────
vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    metadata: vi.fn().mockResolvedValue({ format: 'jpeg' }),
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    flatten: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff])),
  })),
}));

const mockStreamOn = vi.fn();
const mockStreamFinalMessage = vi.fn();
const mockMessagesStream = vi.fn();

// OCR volá beta endpoint (serverový fallback při odmítnutí – Opus 5.5).
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: {
      messages: {
        stream: (...args: unknown[]) => mockMessagesStream(...args),
      },
    },
  })),
}));

// ── Import after mocks ──────────────────────────────
import {
  processWithClaudeBatch,
  processWithClaude,
  batchMaxTokens,
  BATCH_MAX_OUTPUT_TOKENS,
} from '../process.js';

// ── Helpers ─────────────────────────────────────────
function setupMockStream(jsonlOutput: string, stopReason = 'end_turn') {
  let textCb: ((text: string) => void) | undefined;
  mockStreamOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'text') textCb = cb;
    return { on: mockStreamOn, finalMessage: mockStreamFinalMessage };
  });
  mockStreamFinalMessage.mockImplementation(async () => {
    textCb?.(jsonlOutput);
    return {
      id: 'msg_test',
      model: 'claude-opus-4-6',
      usage: { input_tokens: 1000, output_tokens: 500 },
      stop_reason: stopReason,
      content: [{ type: 'text', text: jsonlOutput }],
    };
  });
  mockMessagesStream.mockReturnValue({
    on: mockStreamOn,
    finalMessage: mockStreamFinalMessage,
  });
}

describe('processWithClaudeBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends multiple images and returns parsed JSONL results', async () => {
    const result0 = {
      imageIndex: 0,
      transcription: 'text0',
      detectedLanguage: 'la',
      translation: 'tr0',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    const result1 = {
      imageIndex: 1,
      transcription: 'text1',
      detectedLanguage: 'la',
      translation: 'tr1',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(result0) + '\n' + JSON.stringify(result1));

    const images = [
      { buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 },
      { buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p2', index: 1 },
    ];

    const result = await processWithClaudeBatch(images, 'Přepiš text.');
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.index).toBe(0);
    expect(result.results[0]!.result.transcription).toBe('text0');
    expect(result.results[1]!.index).toBe(1);
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });

  it('includes collectionContext and previousContext in the request', async () => {
    const result0 = {
      imageIndex: 0,
      transcription: 'text0',
      detectedLanguage: 'la',
      translation: 'tr0',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(result0));

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];

    await processWithClaudeBatch(images, 'Přepiš text.', {
      previousContext: '[Stránka 1]\nPředchozí text...',
    });

    // Verify the API was called with content blocks containing the contexts
    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).toContain('Předchozí text...');
  });

  it('uses English context prefix when language is en', async () => {
    const result0 = {
      imageIndex: 0,
      transcription: 'text0',
      detectedLanguage: 'la',
      translation: 'tr0',
      translationLanguage: 'en',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(result0));

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];

    await processWithClaudeBatch(images, 'Transcribe the text.', {
      previousContext: '[Page 1]\nPrevious text...',
      language: 'en',
    });

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Context from previous pages of the manuscript:');
    expect(texts).not.toContain('Kontext z předchozích stránek');
  });

  it('uses Czech context prefix by default', async () => {
    const result0 = {
      imageIndex: 0,
      transcription: 'text0',
      detectedLanguage: 'la',
      translation: 'tr0',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(result0));

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];

    await processWithClaudeBatch(images, 'Přepiš text.', {
      previousContext: '[Stránka 1]\nPředchozí text...',
    });

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).not.toContain('Context from previous pages');
  });

  it('returns empty results for completely unparseable output', async () => {
    setupMockStream('This is not JSONL at all');

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];
    const result = await processWithClaudeBatch(images, 'Přepiš text.');
    expect(result.results).toHaveLength(0);
  });
});

// ── LLM-2 ───────────────────────────────────────────
describe('processWithClaudeBatch – max_tokens a stop_reason (LLM-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const line = (index: number) =>
    JSON.stringify({
      imageIndex: index,
      transcription: `text${index}`,
      detectedLanguage: 'la',
      translation: `tr${index}`,
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    });
  const jpeg = () => Buffer.from([0xff, 0xd8, 0xff]);

  it('batchMaxTokens roste s počtem stránek a nepřekročí konzervativní strop', () => {
    // 16k rezerva na thinking (Opus 5.5 uvažuje vždy) + 8k na stránku
    expect(batchMaxTokens(1)).toBe(24_000);
    expect(batchMaxTokens(3)).toBe(40_000);
    expect(batchMaxTokens(6)).toBe(64_000);
    expect(batchMaxTokens(50)).toBe(BATCH_MAX_OUTPUT_TOKENS);
    // claude-opus-5-5 má max. 128k výstupních tokenů
    expect(BATCH_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(128_000);
  });

  it('posílá max_tokens odvozený od skutečného počtu obrázků v dávce', async () => {
    setupMockStream([0, 1, 2, 3, 4, 5].map(line).join('\n'));
    const images = [0, 1, 2, 3, 4, 5].map((i) => ({ buffer: jpeg(), pageId: `p${i}`, index: i }));

    await processWithClaudeBatch(images, 'Přepiš text.');

    const apiCall = mockMessagesStream.mock.calls[0]![0] as { max_tokens: number };
    // Dřív 2 500 × 6 = 15 000 – hustým stránkám to nestačilo; + 16k na thinking
    expect(apiCall.max_tokens).toBe(64_000);
  });

  it('při stop_reason max_tokens vrátí jen kompletní stránky a příznak truncated', async () => {
    const cut = line(1).slice(0, 40); // useknutý druhý řádek
    setupMockStream(`${line(0)}\n${cut}`, 'max_tokens');
    const images = [0, 1].map((i) => ({ buffer: jpeg(), pageId: `p${i}`, index: i }));

    const result = await processWithClaudeBatch(images, 'Přepiš text.');

    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe('max_tokens');
    expect(result.results.map((r) => r.index)).toEqual([0]);
    // Skutečná spotřeba se vrací pro účtování
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });

  it('před každý obrázek vloží textový popisek s imageIndex (LLM-3)', async () => {
    setupMockStream([0, 1].map(line).join('\n'));
    const images = [0, 1].map((i) => ({ buffer: jpeg(), pageId: `p${i}`, index: i }));

    await processWithClaudeBatch(images, 'Přepiš text.');

    const apiCall = mockMessagesStream.mock.calls[0]![0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const blocks = apiCall.messages[0]!.content;
    expect(blocks.slice(0, 4).map((b) => b.text ?? b.type)).toEqual([
      'imageIndex 0:',
      'image',
      'imageIndex 1:',
      'image',
    ]);
  });

  it('nejednoznačné číslování vrátí jako parseProblem bez výsledků (LLM-3)', async () => {
    setupMockStream(`${line(0)}\n${line(0)}`);
    const images = [0, 1].map((i) => ({ buffer: jpeg(), pageId: `p${i}`, index: i }));

    const result = await processWithClaudeBatch(images, 'Přepiš text.');

    expect(result.results).toEqual([]);
    expect(result.parseProblem).toMatch(/duplicitní imageIndex/);
  });

  it('běžné dokončení není truncated', async () => {
    setupMockStream(line(0));
    const result = await processWithClaudeBatch(
      [{ buffer: jpeg(), pageId: 'p0', index: 0 }],
      'Přepiš text.',
    );
    expect(result.truncated).toBe(false);
    expect(result.stopReason).toBe('end_turn');
  });
});

describe('processWithClaude with previousContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes previousContext in the message content when provided', async () => {
    const singleResult = {
      transcription: 'text',
      detectedLanguage: 'la',
      translation: 'tr',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(singleResult));

    await processWithClaude(
      Buffer.from([0xff, 0xd8, 0x00]),
      'Přepiš text.',
      undefined, // onProgress
      undefined, // estimatedOutputTokens
      '[Stránka 1]\nPředchozí transkripce...',
    );

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).toContain('Předchozí transkripce...');
  });

  it('uses English context prefix when language is en', async () => {
    const singleResult = {
      transcription: 'text',
      detectedLanguage: 'la',
      translation: 'tr',
      translationLanguage: 'en',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(singleResult));

    await processWithClaude(
      Buffer.from([0xff, 0xd8, 0x00]),
      'Transcribe the text.',
      undefined,
      undefined,
      '[Page 1]\nPrevious transcription...',
      'transcribe+translate',
      'en',
    );

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Context from previous pages of the manuscript:');
    expect(texts).not.toContain('Kontext z předchozích stránek');
  });

  it('does not include previousContext when not provided', async () => {
    const singleResult = {
      transcription: 'text',
      detectedLanguage: 'la',
      translation: 'tr',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    setupMockStream(JSON.stringify(singleResult));

    await processWithClaude(Buffer.from([0xff, 0xd8, 0x00]), 'Přepiš text.');

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).not.toContain('Kontext z předchozích stránek');
  });
});
