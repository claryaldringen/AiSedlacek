import Anthropic from '@anthropic-ai/sdk';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

const SYSTEM_PROMPT = `You are an expert in paleography and historical manuscripts. Transcribe the text from this manuscript. Use your knowledge of historical orthography to disambiguate unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then translate the transcribed text fully into the modern standard form of the language the user writes in. Do not summarize — translate the complete text. Preserve all references and citations. Use square brackets to clarify archaic terms or add context a modern reader would need. Then add a brief contextual explanation and a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation into the user's language",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "brief contextual explanation of the document",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}

Return ONLY the JSON object, no markdown fences, no extra text.`;

export interface StructuredOcrResult {
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
}

export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
): Promise<{ result: StructuredOcrResult; processingTimeMs: number }> {
  const startTime = Date.now();
  const client = new Anthropic();
  const mediaType = detectMediaType(image);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
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
            text: userPrompt,
          },
        ],
      },
    ],
  });

  console.log('[Claude] Response:', JSON.stringify({
    id: response.id,
    model: response.model,
    usage: response.usage,
    stop_reason: response.stop_reason,
  }));

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Parse JSON from response (handle potential markdown fences)
  const jsonStr = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(jsonStr) as StructuredOcrResult;

  return {
    result: parsed,
    processingTimeMs: Date.now() - startTime,
  };
}
