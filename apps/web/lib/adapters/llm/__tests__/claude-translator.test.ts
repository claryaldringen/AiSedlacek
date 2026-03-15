import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OcrEngineResult } from '@ai-sedlacek/shared';
import { ClaudeTranslator } from '../claude-translator.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

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

describe('ClaudeTranslator', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: consolidationResponse }],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('consolidateAndTranslate()', () => {
    it('calls Claude API with opus model', async () => {
      const translator = new ClaudeTranslator();
      await translator.consolidateAndTranslate(
        Buffer.from('fake-image'),
        [makeOcrResult('ollama_vision', 'Sample OCR text')],
        'čeština',
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
        }),
      );
    });

    it('sends image as base64 in request', async () => {
      const translator = new ClaudeTranslator();
      const image = Buffer.from('fake-image-data');
      await translator.consolidateAndTranslate(
        image,
        [makeOcrResult('ollama_vision', 'Sample text')],
        'čeština',
      );

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

    it('includes OCR results in the prompt', async () => {
      const translator = new ClaudeTranslator();
      const ocrResults = [
        makeOcrResult('ollama_vision', 'První engine výstup'),
        makeOcrResult('claude_vision', 'Druhý engine výstup'),
      ];

      await translator.consolidateAndTranslate(Buffer.from('img'), ocrResults, 'čeština');

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = callArgs![0] as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const textContent = requestBody.messages[0]?.content.find(
        (c: { type: string }) => c.type === 'text',
      ) as { type: string; text?: string } | undefined;
      expect(textContent?.text).toContain('První engine výstup');
      expect(textContent?.text).toContain('Druhý engine výstup');
    });

    it('parses consolidation response sections correctly', async () => {
      const translator = new ClaudeTranslator();
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

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: responseWithNotes }],
      });

      const translator = new ClaudeTranslator();
      const result = await translator.consolidateAndTranslate(
        Buffer.from('img'),
        [makeOcrResult('ollama_vision', 'text')],
        'čeština',
      );

      expect(result.notes).toBeInstanceOf(Array);
    });
  });

  describe('polish()', () => {
    it('calls Claude API with opus model', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Polished text' }],
      });

      const translator = new ClaudeTranslator();
      await translator.polish('Doslovný překlad textu', 'čeština');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
        }),
      );
    });

    it('sends text-only request without image content', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Polished text' }],
      });

      const translator = new ClaudeTranslator();
      await translator.polish('Doslovný překlad textu', 'čeština');

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = callArgs![0] as { messages: { content: unknown }[] };
      // polish() sends a string or text-only content – no 'image' type block
      const content = requestBody.messages[0]?.content;
      if (Array.isArray(content)) {
        const hasImage = content.some((c: unknown) => (c as { type: string }).type === 'image');
        expect(hasImage).toBe(false);
      } else {
        // String content – definitely no image
        expect(typeof content).toBe('string');
      }
    });

    it('returns the text from API response', async () => {
      const polishedText = 'Krásně učesaný moderní překlad.';
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: polishedText }],
      });

      const translator = new ClaudeTranslator();
      const result = await translator.polish('Doslovný překlad textu', 'čeština');

      expect(result).toBe(polishedText);
    });

    it('includes the literal translation in the request', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Result' }],
      });

      const translator = new ClaudeTranslator();
      const literalTranslation = 'Unikátní doslovný překlad textu pro test';
      await translator.polish(literalTranslation, 'čeština');

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = callArgs![0] as { messages: { content: unknown }[] };
      const content = requestBody.messages[0]?.content;
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      expect(contentStr).toContain(literalTranslation);
    });
  });
});
