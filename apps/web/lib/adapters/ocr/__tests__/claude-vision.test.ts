import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeVisionOcrEngine } from '../claude-vision.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Přepis textu\n[?slovo?]' }],
      }),
    },
  })),
}));

describe('ClaudeVisionOcrEngine', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('name and role', () => {
    it('has correct name', () => {
      const engine = new ClaudeVisionOcrEngine();
      expect(engine.name).toBe('claude_vision');
    });

    it('has correct role', () => {
      const engine = new ClaudeVisionOcrEngine();
      expect(engine.role).toBe('recognizer');
    });
  });

  describe('isAvailable()', () => {
    it('returns true when ANTHROPIC_API_KEY is set', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when ANTHROPIC_API_KEY is not set', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('recognize()', () => {
    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    });

    it('returns OcrEngineResult with correct engine and role', async () => {
      const engine = new ClaudeVisionOcrEngine();
      const image = Buffer.from('fake-image-data');
      const result = await engine.recognize(image);

      expect(result.engine).toBe('claude_vision');
      expect(result.role).toBe('recognizer');
    });

    it('returns text from API response', async () => {
      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.recognize(Buffer.from('fake-image'));

      expect(result.text).toBe('Přepis textu\n[?slovo?]');
    });

    it('parses uncertain markers from response text', async () => {
      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.recognize(Buffer.from('fake-image'));

      expect(result.uncertainMarkers).toContain('slovo');
    });

    it('returns processingTimeMs as a number', async () => {
      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.recognize(Buffer.from('fake-image'));

      expect(typeof result.processingTimeMs).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('extracts multiple uncertain markers', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockInstance = {
        messages: {
          create: vi.fn().mockResolvedValueOnce({
            content: [{ type: 'text', text: 'Text [?slovo1?] more [?slovo2?] content' }],
          }),
        },
      };
      vi.mocked(Anthropic).mockImplementationOnce(() => mockInstance as never);

      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.recognize(Buffer.from('img'));

      expect(result.uncertainMarkers).toEqual(['slovo1', 'slovo2']);
    });

    it('returns empty uncertainMarkers when no markers in text', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockInstance = {
        messages: {
          create: vi.fn().mockResolvedValueOnce({
            content: [{ type: 'text', text: 'Čistý text bez nejistot' }],
          }),
        },
      };
      vi.mocked(Anthropic).mockImplementationOnce(() => mockInstance as never);

      const engine = new ClaudeVisionOcrEngine();
      const result = await engine.recognize(Buffer.from('img'));

      expect(result.uncertainMarkers).toEqual([]);
    });
  });
});
