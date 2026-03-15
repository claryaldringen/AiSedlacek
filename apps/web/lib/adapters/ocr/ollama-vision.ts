import type { IOcrEngine } from '@ai-sedlacek/shared';
import type { OcrEngineResult, OcrOptions, OllamaConfig } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';

export class OllamaVisionOcrEngine implements IOcrEngine {
  readonly name = 'ollama_vision' as const;
  readonly role = 'recognizer' as const;

  constructor(private readonly config: OllamaConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;

      // Check if the required model is actually installed
      const data = (await response.json()) as { models?: { name: string }[] };
      const models = data.models ?? [];
      const modelBase = this.config.model.split(':')[0];
      return models.some((m) => m.name.startsWith(modelBase ?? ''));
    } catch {
      return false;
    }
  }

  async recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult> {
    void options; // options reserved for future use (language hints, tier)
    const startTime = Date.now();

    const imageBase64 = image.toString('base64');

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: OCR_TRANSCRIPTION_PROMPT,
            images: [imageBase64],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    const text = data.message.content;

    const uncertainMarkers = [...text.matchAll(/\[\?(.+?)\?\]/g)]
      .map((m) => m[1])
      .filter((s): s is string => s !== undefined);

    return {
      engine: this.name,
      role: this.role,
      text,
      uncertainMarkers,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
