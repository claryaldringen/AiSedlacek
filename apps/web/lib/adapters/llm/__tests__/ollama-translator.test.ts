import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OllamaConfig, OcrEngineResult } from '@ai-sedlacek/shared';
import { OllamaTranslator } from '../ollama-translator.js';

const defaultConfig: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2-vision',
  timeoutMs: 5000,
};

function makeOcrResult(engine: string, text: string): OcrEngineResult {
  return {
    engine: engine as OcrEngineResult['engine'],
    role: 'recognizer',
    text,
    processingTimeMs: 10,
  };
}

const consolidationResponse = `---KONSOLIDOVANÝ TEXT---
Hvězda svítí na nebi.

---DOSLOVNÝ PŘEKLAD---
Hvězda svítí na nebi.

---POZNÁMKY---
Žádné nejistoty nalezeny.`;

describe('OllamaTranslator', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('consolidateAndTranslate()', () => {
    it('sends image and OCR results to Ollama', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: consolidationResponse } }), {
          status: 200,
        }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const image = Buffer.from('fake-image');
      const ocrResults = [makeOcrResult('ollama_vision', 'Sample OCR text')];

      await translator.consolidateAndTranslate(image, ocrResults, 'čeština');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({ method: 'POST' }),
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.messages[0].images).toBeDefined();
      expect(body.messages[0].images[0]).toBe(image.toString('base64'));
    });

    it('uses vision model for multimodal consolidation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: consolidationResponse } }), {
          status: 200,
        }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      await translator.consolidateAndTranslate(
        Buffer.from('img'),
        [makeOcrResult('ollama_vision', 'text')],
        'čeština',
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      // Vision model is used for multimodal consolidation
      expect(body.model).toBe('llama3.2-vision');
    });

    it('includes OCR results in the prompt', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: consolidationResponse } }), {
          status: 200,
        }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const ocrResults = [
        makeOcrResult('ollama_vision', 'První engine výstup'),
        makeOcrResult('claude_vision', 'Druhý engine výstup'),
      ];

      await translator.consolidateAndTranslate(Buffer.from('img'), ocrResults, 'čeština');

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.messages[0].content).toContain('První engine výstup');
      expect(body.messages[0].content).toContain('Druhý engine výstup');
    });

    it('parses consolidation response sections correctly', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: consolidationResponse } }), {
          status: 200,
        }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const result = await translator.consolidateAndTranslate(
        Buffer.from('img'),
        [makeOcrResult('ollama_vision', 'text')],
        'čeština',
      );

      expect(result.consolidatedText.trim()).toBe('Hvězda svítí na nebi.');
      expect(result.literalTranslation.trim()).toBe('Hvězda svítí na nebi.');
      expect(result.notes).toBeInstanceOf(Array);
      expect(result.notes.length).toBeGreaterThan(0);
    });

    it('returns notes as an array of strings', async () => {
      const responseWithNotes = `---KONSOLIDOVANÝ TEXT---
Text originálu.

---DOSLOVNÝ PŘEKLAD---
Text překladu.

---POZNÁMKY---
- Slovo "xyz" nejisté čtení
- Řádek 3 poškozený`;

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: responseWithNotes } }), { status: 200 }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const result = await translator.consolidateAndTranslate(
        Buffer.from('img'),
        [makeOcrResult('ollama_vision', 'text')],
        'čeština',
      );

      expect(result.notes).toBeInstanceOf(Array);
    });

    it('throws on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      await expect(
        translator.consolidateAndTranslate(
          Buffer.from('img'),
          [makeOcrResult('ollama_vision', 'text')],
          'čeština',
        ),
      ).rejects.toThrow();
    });
  });

  describe('polish()', () => {
    it('sends text-only request without images', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: 'Polished translation text' } }), {
          status: 200,
        }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      await translator.polish('Doslovný překlad textu', 'čeština');

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.messages[0].images).toBeUndefined();
    });

    it('uses text model (not vision model) for polish', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: 'Polished text' } }), { status: 200 }),
      );

      const configWithTextModel: OllamaConfig = {
        ...defaultConfig,
        model: 'qwen2.5',
      };
      const translator = new OllamaTranslator(configWithTextModel);
      await translator.polish('Doslovný překlad textu', 'čeština');

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.model).toBe('qwen2.5');
    });

    it('returns the raw response text', async () => {
      const polishedText = 'Krásně učesaný moderní překlad.';
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: polishedText } }), { status: 200 }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const result = await translator.polish('Doslovný překlad textu', 'čeština');

      expect(result).toBe(polishedText);
    });

    it('includes the literal translation in the prompt', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: 'Result' } }), { status: 200 }),
      );

      const translator = new OllamaTranslator(defaultConfig);
      const literalTranslation = 'Unikátní doslovný překlad textu pro test';
      await translator.polish(literalTranslation, 'čeština');

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs).toBeDefined();
      const body = JSON.parse(callArgs![1]?.body as string);
      expect(body.messages[0].content).toContain(literalTranslation);
    });

    it('throws on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

      const translator = new OllamaTranslator(defaultConfig);
      await expect(translator.polish('text', 'čeština')).rejects.toThrow();
    });
  });
});
