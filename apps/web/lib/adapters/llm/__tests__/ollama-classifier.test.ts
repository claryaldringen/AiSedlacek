import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OllamaConfig } from '@ai-sedlacek/shared';
import { OllamaLayoutClassifier } from '../ollama-classifier.js';

const defaultConfig: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2-vision',
  timeoutMs: 5000,
};

const validClassificationJson = JSON.stringify({
  tier: 'tier1',
  scriptType: 'print',
  layoutComplexity: 'simple',
  detectedFeatures: ['fraktur', 'jednosloupcový'],
  confidence: 0.92,
  reasoning: 'Tištěný jednosloupcový text, bez gloss.',
});

describe('OllamaLayoutClassifier', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('classify()', () => {
    it('parses valid classification JSON from response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: validClassificationJson } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
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

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: tier2Json } }), { status: 200 }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier2');
      expect(result.scriptType).toBe('manuscript');
      expect(result.layoutComplexity).toBe('complex');
    });

    it('falls back to tier1 on invalid/non-JSON response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: 'Toto není JSON odpověď.' } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0);
    });

    it('falls back to tier1 on malformed JSON in response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: '{ broken json {{{' } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
    });

    it('falls back to tier1 on API error (non-200 status)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0);
    });

    it('sends image as base64 to Ollama API', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: validClassificationJson } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const image = Buffer.from('test-image-data');
      await classifier.classify(image);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({ method: 'POST' }),
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.messages[0].images[0]).toBe(image.toString('base64'));
    });

    it('includes CLASSIFY_LAYOUT_PROMPT in the request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: validClassificationJson } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      await classifier.classify(Buffer.from('fake-image'));

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      // CLASSIFY_LAYOUT_PROMPT contains this distinctive text
      expect(body.messages[0].content).toContain('středověkého dokumentu');
    });

    it('parses JSON embedded in surrounding text', async () => {
      const responseWithSurroundingText = `Zde je klasifikace dokumentu:\n${validClassificationJson}\nHotovo.`;

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: responseWithSurroundingText } }), {
          status: 200,
        }),
      );

      const classifier = new OllamaLayoutClassifier(defaultConfig);
      const result = await classifier.classify(Buffer.from('fake-image'));

      expect(result.tier).toBe('tier1');
      expect(result.confidence).toBe(0.92);
    });
  });
});
