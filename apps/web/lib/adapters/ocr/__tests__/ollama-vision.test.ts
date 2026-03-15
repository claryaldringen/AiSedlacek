import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OllamaConfig } from '@ai-sedlacek/shared';
import { OllamaVisionOcrEngine } from '../ollama-vision.js';

const defaultConfig: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2-vision',
  timeoutMs: 5000,
};

describe('OllamaVisionOcrEngine', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('name and role', () => {
    it('has correct name', () => {
      const engine = new OllamaVisionOcrEngine(defaultConfig);
      expect(engine.name).toBe('ollama_vision');
    });

    it('has correct role', () => {
      const engine = new OllamaVisionOcrEngine(defaultConfig);
      expect(engine.role).toBe('recognizer');
    });
  });

  describe('isAvailable()', () => {
    it('returns true when /api/tags endpoint responds with 200 and model is present', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [{ name: 'llama3.2-vision:11b' }] }),
          { status: 200 },
        ),
      );
      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const result = await engine.isAvailable();
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns false when fetch throws (e.g. connection refused)', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'));
      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });

    it('returns false when server responds with non-200 status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('recognize()', () => {
    it('sends correct API call to /api/chat', async () => {
      const mockResponse = {
        message: { content: 'Transcribed medieval text' },
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const image = Buffer.from('fake-image-data');
      await engine.recognize(image);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.model).toBe('llama3.2-vision');
      expect(body.stream).toBe(false);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].images).toHaveLength(1);
      expect(body.messages[0].images[0]).toBe(image.toString('base64'));
    });

    it('parses response and returns OcrEngineResult', async () => {
      const mockResponse = {
        message: { content: 'Přepsaný středověký text\nDruhý řádek [?nejasné?]' },
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const image = Buffer.from('fake-image-data');
      const result = await engine.recognize(image);

      expect(result.engine).toBe('ollama_vision');
      expect(result.role).toBe('recognizer');
      expect(result.text).toBe('Přepsaný středověký text\nDruhý řádek [?nejasné?]');
      expect(result.uncertainMarkers).toContain('nejasné');
      expect(typeof result.processingTimeMs).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('extracts multiple uncertain markers from response', async () => {
      const mockResponse = {
        message: { content: 'Text [?slovo1?] více [?slovo2?] nejistoty [...]' },
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      const result = await engine.recognize(Buffer.from('img'));

      expect(result.uncertainMarkers).toEqual(['slovo1', 'slovo2']);
    });

    it('throws when API responds with non-200 status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      await expect(engine.recognize(Buffer.from('img'))).rejects.toThrow();
    });

    it('throws when fetch itself fails', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      await expect(engine.recognize(Buffer.from('img'))).rejects.toThrow('Network error');
    });

    it('includes OCR_TRANSCRIPTION_PROMPT in the message content', async () => {
      const mockResponse = { message: { content: 'text' } };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const engine = new OllamaVisionOcrEngine(defaultConfig);
      await engine.recognize(Buffer.from('img'));

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      // OCR_TRANSCRIPTION_PROMPT contains this distinctive Czech text
      expect(body.messages[0].content).toContain('paleograf');
    });
  });
});
