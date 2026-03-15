import type { IOcrEngine } from '@ai-sedlacek/shared';
import type { OcrEngineResult, OcrOptions, OllamaConfig } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';

export class OllamaVisionOcrEngine implements IOcrEngine {
  readonly name = 'ollama_vision' as const;
  readonly role = 'recognizer' as const;

  constructor(private readonly config: OllamaConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async recognize(image: Buffer, _options?: OcrOptions): Promise<OcrEngineResult> {
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
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { message: { content: string } };
    const text = data.message.content;

    const uncertainMarkers = [...text.matchAll(/\[\?(.+?)\?\]/g)].map((m) => m[1]);

    return {
      engine: this.name,
      role: this.role,
      text,
      uncertainMarkers,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
