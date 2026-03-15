import Anthropic from '@anthropic-ai/sdk';
import type { IOcrEngine } from '@ai-sedlacek/shared';
import type { OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

export class ClaudeVisionOcrEngine implements IOcrEngine {
  readonly name = 'claude_vision' as const;
  readonly role = 'recognizer' as const;

  async isAvailable(): Promise<boolean> {
    return !!process.env['ANTHROPIC_API_KEY'];
  }

  async recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult> {
    const startTime = Date.now();

    const client = new Anthropic();
    const mediaType = detectMediaType(image);

    // Build prompt with classification context if available
    let prompt = OCR_TRANSCRIPTION_PROMPT;
    if (options?.context) {
      prompt = `KONTEXT DOKUMENTU (z předchozí klasifikace): ${options.context}\n\n${prompt}`;
    }

      const response = await client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          system: 'You are an expert in paleography and historical '
              + 'manuscripts. Transcribe the text from this manuscript. '
              + 'Use your knowledge of historical orthography to '
              + 'disambiguate unclear characters (e.g. long ſ looks '
              + 'like f — always transcribe it as s). After the '
              + 'transcription, add a translation into modern standard '
              + 'language the user writes in, a brief contextual '
              + 'explanation, and a glossary of terms that may be '
              + 'unfamiliar to a modern reader. Respond in the '
              + 'user\'s language.',
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

    console.log('[ClaudeVision] Full API response:', JSON.stringify({
      id: response.id,
      model: response.model,
      stop_reason: response.stop_reason,
      usage: response.usage,
      content: response.content,
    }, null, 2));

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
