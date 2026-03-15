import Anthropic from '@anthropic-ai/sdk';
import type { IOcrEngine } from '@ai-sedlacek/shared';
import type { OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';

export class ClaudeVisionOcrEngine implements IOcrEngine {
  readonly name = 'claude_vision' as const;
  readonly role = 'recognizer' as const;

  async isAvailable(): Promise<boolean> {
    return !!process.env['ANTHROPIC_API_KEY'];
  }

  async recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult> {
    void options; // options reserved for future use (language hints, tier)
    const startTime = Date.now();

    const client = new Anthropic();
    const imageBase64 = image.toString('base64');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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
              text: OCR_TRANSCRIPTION_PROMPT,
            },
          ],
        },
      ],
    });

    const firstContent = response.content[0];
    const text = firstContent?.type === 'text' ? firstContent.text : '';

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
