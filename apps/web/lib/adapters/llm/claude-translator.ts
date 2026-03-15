import Anthropic from '@anthropic-ai/sdk';
import type { ITranslator } from '@ai-sedlacek/shared';
import type { OcrEngineResult, ConsolidationResult } from '@ai-sedlacek/shared';
import { buildConsolidationPrompt, buildPolishPrompt } from '@ai-sedlacek/shared';

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
    const imageBase64 = image.toString('base64');

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
                media_type: 'image/jpeg',
                data: imageBase64,
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
    const literalMatch = text.match(
      /---DOSLOVNÝ PŘEKLAD---\s*([\s\S]*?)(?=---POZNÁMKY---|$)/,
    );
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
