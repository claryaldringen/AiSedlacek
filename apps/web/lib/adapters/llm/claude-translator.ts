import Anthropic from '@anthropic-ai/sdk';
import type { ITranslator } from '@ai-sedlacek/shared';
import type { OcrEngineResult, ConsolidationResult } from '@ai-sedlacek/shared';
import { buildConsolidationPrompt, buildPolishPrompt } from '@ai-sedlacek/shared';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

export class ClaudeTranslator implements ITranslator {
  async consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult> {
    const recognizerResults = ocrResults.filter((r) => r.role === 'recognizer');
    const ocrSection = recognizerResults
      .map((r) => `--- ${r.engine.toUpperCase()} ---\n${r.text}`)
      .join('\n\n');

    const prompt = buildConsolidationPrompt(
      ocrSection,
      targetLanguage,
      recognizerResults.length,
      recognizerResults.map((r) => r.engine),
    );

    const client = new Anthropic();
    const mediaType = detectMediaType(image);

    const response = await client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: image.toString('base64'),
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    const firstContent = response.content[0];
    const responseText = firstContent?.type === 'text' ? firstContent.text : '';

    return this.parseConsolidationResponse(responseText);
  }

  async polish(literalTranslation: string, targetLanguage: string): Promise<string> {
    const prompt = `${buildPolishPrompt(targetLanguage)}\n\n${literalTranslation}`;

    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const firstContent = response.content[0];
    return firstContent?.type === 'text' ? firstContent.text : '';
  }

  private parseConsolidationResponse(text: string): ConsolidationResult {
    const consolidatedMatch = text.match(
      /---KONSOLIDOVANÝ TEXT---\s*([\s\S]*?)(?=---DOSLOVNÝ PŘEKLAD---|$)/,
    );
    const literalMatch = text.match(/---DOSLOVNÝ PŘEKLAD---\s*([\s\S]*?)(?=---POZNÁMKY---|$)/);
    const notesMatch = text.match(/---POZNÁMKY---\s*([\s\S]*?)$/);

    const consolidatedText = (consolidatedMatch?.[1] ?? text).trim();
    const literalTranslation = (literalMatch?.[1] ?? '').trim();
    const notesRaw = (notesMatch?.[1] ?? '').trim();

    const notes = notesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      consolidatedText,
      literalTranslation,
      notes,
    };
  }
}
