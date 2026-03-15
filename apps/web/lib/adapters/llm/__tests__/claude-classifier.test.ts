import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeLayoutClassifier } from '../claude-classifier.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

const validClassificationJson = JSON.stringify({
  tier: 'tier1',
  scriptType: 'print',
  layoutComplexity: 'simple',
  detectedFeatures: ['fraktur', 'jednosloupcový'],
  confidence: 0.92,
  reasoning: 'Tištěný jednosloupcový text, bez gloss.',
});

describe('ClaudeLayoutClassifier', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: validClassificationJson }],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('classify()', () => {
    it('calls Claude API with sonnet model', async () => {
      const classifier = new ClaudeLayoutClassifier();
      await classifier.classify(Buffer.from('fake-image'));

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        }),
      );
    });

    it('parses valid classification JSON from response', async () => {
      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.scriptType).toBe('print');
      expect(result.layoutComplexity).toBe('simple');
      expect(result.detectedFeatures).toContain('fraktur');
      expect(result.confidence).toBe(0.92);
      expect(result.reasoning).toBe('Tištěný jednosloupcový text, bez gloss.');
    });

    it('parses tier2 classification correctly', async () => {
      const tier2Json = JSON.stringify({
        tier: 'tier2',
        scriptType: 'manuscript',
        layoutComplexity: 'complex',
        detectedFeatures: ['marginální_glosy', 'interlineární_poznámky'],
        confidence: 0.78,
        reasoning: 'Rukopis s marginálními glosami.',
      });

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: tier2Json }],
      });

      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier2');
      expect(result.scriptType).toBe('manuscript');
      expect(result.layoutComplexity).toBe('complex');
    });

    it('falls back to tier1 on invalid/non-JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Toto není JSON odpověď.' }],
      });

      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0);
    });

    it('falls back to tier1 on malformed JSON in response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{ broken json {{{' }],
      });

      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
    });

    it('falls back to tier1 on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API Error'));

      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0);
    });

    it('sends image as base64 in request', async () => {
      const classifier = new ClaudeLayoutClassifier();
      const image = Buffer.from('test-image-data');
      await classifier.classify(image);

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = callArgs![0] as {
        messages: { content: { type: string; source?: { data: string } }[] }[];
      };
      const imageContent = requestBody.messages[0]?.content.find(
        (c: { type: string }) => c.type === 'image',
      ) as { type: string; source?: { data: string } } | undefined;
      expect(imageContent?.source?.data).toBe(image.toString('base64'));
    });

    it('includes CLASSIFY_LAYOUT_PROMPT in the request', async () => {
      const classifier = new ClaudeLayoutClassifier();
      await classifier.classify(Buffer.from('fake-image'));

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = callArgs![0] as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const textContent = requestBody.messages[0]?.content.find(
        (c: { type: string }) => c.type === 'text',
      ) as { type: string; text?: string } | undefined;
      // CLASSIFY_LAYOUT_PROMPT contains this distinctive Czech text
      expect(textContent?.text).toContain('historického dokumentu');
    });

    it('parses JSON embedded in surrounding text', async () => {
      const responseWithSurroundingText = `Zde je klasifikace dokumentu:\n${validClassificationJson}\nHotovo.`;

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: responseWithSurroundingText }],
      });

      const classifier = new ClaudeLayoutClassifier();
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0.92);
    });
  });
});
