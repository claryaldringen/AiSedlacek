import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────
vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0x00])),
  })),
}));

const mockStreamOn = vi.fn();
const mockStreamFinalMessage = vi.fn();
const mockMessagesStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      stream: (...args: unknown[]) => mockMessagesStream(...args),
    },
  })),
}));

// ── Import after mocks ──────────────────────────────
import { processWithClaudeBatch } from '../claude-vision';
import { processWithClaude } from '../claude-vision';

// ── Helpers ─────────────────────────────────────────
function setupMockStream(jsonlOutput: string) {
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
      stop_reason: 'end_turn',
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
    const result0 = { imageIndex: 0, transcription: 'text0', detectedLanguage: 'la', translation: 'tr0', translationLanguage: 'cs', context: '', glossary: [] };
    const result1 = { imageIndex: 1, transcription: 'text1', detectedLanguage: 'la', translation: 'tr1', translationLanguage: 'cs', context: '', glossary: [] };
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
    const result0 = { imageIndex: 0, transcription: 'text0', detectedLanguage: 'la', translation: 'tr0', translationLanguage: 'cs', context: '', glossary: [] };
    setupMockStream(JSON.stringify(result0));

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];

    await processWithClaudeBatch(images, 'Přepiš text.', {
      collectionContext: 'Jenský Kodex, 15. století',
      previousContext: '[Stránka 1]\nPředchozí text...',
    });

    // Verify the API was called with content blocks containing the contexts
    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).toContain('Předchozí text...');
    expect(texts).toContain('Kontext díla');
    expect(texts).toContain('Jenský Kodex');
  });

  it('returns empty results for completely unparseable output', async () => {
    setupMockStream('This is not JSONL at all');

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];
    const result = await processWithClaudeBatch(images, 'Přepiš text.');
    expect(result.results).toHaveLength(0);
  });
});

describe('processWithClaude with previousContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes previousContext in the message content when provided', async () => {
    const singleResult = { transcription: 'text', detectedLanguage: 'la', translation: 'tr', translationLanguage: 'cs', context: '', glossary: [] };
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

  it('does not include previousContext when not provided', async () => {
    const singleResult = { transcription: 'text', detectedLanguage: 'la', translation: 'tr', translationLanguage: 'cs', context: '', glossary: [] };
    setupMockStream(JSON.stringify(singleResult));

    await processWithClaude(
      Buffer.from([0xff, 0xd8, 0x00]),
      'Přepiš text.',
    );

    const apiCall = mockMessagesStream.mock.calls[0]![0] as Record<string, unknown>;
    const messages = apiCall.messages as { content: { type: string; text?: string }[] }[];
    const textBlocks = messages[0]!.content.filter((b) => b.type === 'text');
    const texts = textBlocks.map((b) => b.text).join('\n');
    expect(texts).not.toContain('Kontext z předchozích stránek');
  });
});
