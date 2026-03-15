import type { ITranslator } from '@ai-sedlacek/shared';
import type { OcrEngineResult, ConsolidationResult, OllamaConfig } from '@ai-sedlacek/shared';
import { buildConsolidationPrompt, buildPolishPrompt } from '@ai-sedlacek/shared';

interface OllamaChatResponse {
  message: { content: string };
}

export class OllamaTranslator implements ITranslator {
  constructor(private readonly config: OllamaConfig) {}

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

    const responseText = await this.callOllama(this.config.model, prompt, image);
    return this.parseConsolidationResponse(responseText);
  }

  async polish(literalTranslation: string, targetLanguage: string): Promise<string> {
    const prompt = `${buildPolishPrompt(targetLanguage)}\n\n${literalTranslation}`;
    return this.callOllama(this.config.model, prompt);
  }

  private async callOllama(model: string, prompt: string, image?: Buffer): Promise<string> {
    const messageContent: Record<string, unknown> = {
      role: 'user',
      content: prompt,
    };

    if (image !== undefined) {
      messageContent['images'] = [image.toString('base64')];
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [messageContent],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.message.content;
  }

  private parseConsolidationResponse(text: string): ConsolidationResult {
    const consolidatedMatch = text.match(
      /---KONSOLIDOVANÝ TEXT---\s*([\s\S]*?)(?=---DOSLOVNÝ PŘEKLAD---|$)/,
    );
    const literalMatch = text.match(
      /---DOSLOVNÝ PŘEKLAD---\s*([\s\S]*?)(?=---POZNÁMKY---|$)/,
    );
    const notesMatch = text.match(/---POZNÁMKY---\s*([\s\S]*?)$/);

    const consolidatedText = consolidatedMatch ? consolidatedMatch[1].trim() : text;
    const literalTranslation = literalMatch ? literalMatch[1].trim() : '';
    const notesRaw = notesMatch ? notesMatch[1].trim() : '';

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
