import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { BATCH_OCR_INSTRUCTION, TRANSLATE_ONLY_SYSTEM_PROMPT } from '@ai-sedlacek/shared';

export type ProcessingMode = 'transcribe+translate' | 'translate';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

const SYSTEM_PROMPT = `You are an expert in paleography and historical manuscripts. Transcribe the text from this manuscript. Use your knowledge of historical orthography to disambiguate unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then translate the transcribed text fully into the modern standard form of the language the user writes in. Do not summarize — translate the complete text. Preserve all references and citations. Use square brackets to clarify archaic terms or add context a modern reader would need. Then add a brief contextual explanation and a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text in markdown (preserve line breaks, use headings, bold for initials etc.)",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation in markdown (preserve structure, headings, line breaks matching the original)",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "page-specific context only: identify biblical quotes, literary references, named persons, places, or events mentioned on THIS page. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context. Focus on what helps the reader understand this specific page.",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}

Use \\n for newlines inside JSON strings. Return ONLY the JSON object, no markdown fences, no extra text.`;

export interface StructuredOcrResult {
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
}

export function parseOcrJson(raw: string): StructuredOcrResult {
  let jsonStr = raw.trim();
  // Strip ```json ... ``` fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1] ?? jsonStr;
  }
  // Extract JSON object if surrounded by extra text
  if (!jsonStr.startsWith('{')) {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }
  }
  // Try parsing as-is first
  try {
    return JSON.parse(jsonStr) as StructuredOcrResult;
  } catch {
    const fixed = fixJsonString(jsonStr);
    return JSON.parse(fixed) as StructuredOcrResult;
  }
}

export function parseOcrJsonBatch(
  raw: string,
  maxResults?: number,
): { index: number; result: StructuredOcrResult }[] {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1] ?? text;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const results: { index: number; result: StructuredOcrResult }[] = [];
  let positionalIndex = 0;

  for (const line of lines) {
    if (maxResults !== undefined && results.length >= maxResults) break;
    try {
      const parsed = parseOcrJson(line);
      let imageIndex: number | undefined;
      try {
        const rawObj = JSON.parse(line.trim().startsWith('{') ? line.trim() : '{}');
        if (typeof rawObj.imageIndex === 'number') {
          imageIndex = rawObj.imageIndex;
        }
      } catch {
        // ignore — use positional fallback
      }
      results.push({ index: imageIndex ?? positionalIndex, result: parsed });
      positionalIndex++;
    } catch {
      console.warn('[Claude Batch] Skipping unparseable JSONL line:', line.slice(0, 80));
    }
  }

  return results;
}

/**
 * Fix broken JSON from LLM output by escaping unescaped characters inside string values.
 */
function fixJsonString(json: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i]!;

    if (!inString) {
      out.push(ch);
      if (ch === '"') inString = true;
      i++;
      continue;
    }

    // Inside a string
    if (ch === '\\') {
      out.push(ch);
      i++;
      if (i < json.length) {
        out.push(json[i]!);
        i++;
      }
      continue;
    }

    if (ch === '"') {
      const rest = json.slice(i + 1);
      const afterQuote = rest.match(/^\s*([:}\]\n]|,\s*["{\[\d]|$)/);
      if (afterQuote) {
        out.push(ch);
        inString = false;
        i++;
        continue;
      }
      out.push('\\"');
      i++;
      continue;
    }

    if (ch === '\n') {
      out.push('\\n');
      i++;
      continue;
    }
    if (ch === '\r') {
      out.push('\\r');
      i++;
      continue;
    }
    if (ch === '\t') {
      out.push('\\t');
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

async function prepareImage(image: Buffer): Promise<{ buffer: Buffer; mediaType: ImageMediaType }> {
  // API limit is 5 MB for base64-encoded data. Base64 inflates size by ~4/3,
  // so the raw file must be under ~3.75 MB to stay within the 5 MB base64 limit.
  const MAX_BASE64_BYTES = 5 * 1024 * 1024;
  const MAX_RAW_BYTES = Math.floor(MAX_BASE64_BYTES * 3 / 4); // ~3.75 MB
  let imageToSend = image;

  if (image.length > MAX_RAW_BYTES) {
    console.log(
      `[Claude] Image too large (${(image.length / 1024 / 1024).toFixed(1)} MB), resizing…`,
    );
    imageToSend = await sharp(image)
      .resize({ width: 3000, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (imageToSend.length > MAX_RAW_BYTES) {
      imageToSend = await sharp(image)
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    }
    console.log(`[Claude] Resized to ${(imageToSend.length / 1024 / 1024).toFixed(1)} MB`);
  }

  return { buffer: imageToSend, mediaType: detectMediaType(imageToSend) };
}

export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  estimatedOutputTokens?: number,
  previousContext?: string,
  mode: ProcessingMode = 'transcribe+translate',
): Promise<{
  result: StructuredOcrResult;
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const startTime = Date.now();
  const client = new Anthropic();
  const { buffer: imageToSend, mediaType } = await prepareImage(image);

  const estimated = estimatedOutputTokens ?? 1500;
  let fullText = '';

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    temperature: 0.3,
    system: mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageToSend.toString('base64'),
            },
          },
          ...(previousContext
            ? [
                {
                  type: 'text' as const,
                  text: `Kontext z předchozích stránek rukopisu:\n${previousContext}`,
                },
              ]
            : []),
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  });

  stream.on('text', (text) => {
    fullText += text;
    const currentTokens = Math.round(fullText.length / 4);
    onProgress?.(currentTokens, estimated);
  });

  const finalMessage = await stream.finalMessage();

  console.log(
    '[Claude] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
    }),
  );

  const text =
    fullText || (finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '');

  const parsed = parseOcrJson(text);

  return {
    result: parsed,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}

export async function processWithClaudeBatch(
  images: { buffer: Buffer; pageId: string; index: number }[],
  userPrompt: string,
  options?: {
    collectionContext?: string;
    previousContext?: string;
    onProgress?: (outputTokens: number, estimatedTotal: number) => void;
    estimatedOutputTokens?: number;
    mode?: ProcessingMode;
  },
): Promise<{
  results: { index: number; result: StructuredOcrResult }[];
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const startTime = Date.now();
  const client = new Anthropic();

  // Prepare all images in parallel
  const preparedImages = await Promise.all(
    images.map(async (img) => {
      const { buffer, mediaType } = await prepareImage(img.buffer);
      return { ...img, buffer, mediaType };
    }),
  );

  // Build content blocks: images first, then text contexts, then prompt
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    | { type: 'text'; text: string }
  > = [];

  for (const img of preparedImages) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.buffer.toString('base64'),
      },
    });
  }

  if (options?.previousContext) {
    content.push({
      type: 'text',
      text: `Kontext z předchozích stránek rukopisu:\n${options.previousContext}`,
    });
  }

  if (options?.collectionContext) {
    content.push({
      type: 'text',
      text: `Kontext díla (použij pro lepší porozumění dokumentu):\n${options.collectionContext}`,
    });
  }

  content.push({ type: 'text', text: userPrompt });

  const estimated = options?.estimatedOutputTokens ?? 2500 * images.length;
  let fullText = '';
  const maxTokens = Math.min(Math.max(8192, 2500 * images.length), 128_000);

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    temperature: 0.3,
    system:
      (options?.mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT) +
      '\n\n' +
      BATCH_OCR_INSTRUCTION,
    messages: [{ role: 'user', content }],
  });

  stream.on('text', (text) => {
    fullText += text;
    const currentTokens = Math.round(fullText.length / 4);
    options?.onProgress?.(currentTokens, estimated);
  });

  const finalMessage = await stream.finalMessage();

  console.log(
    '[Claude Batch] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
      imageCount: images.length,
    }),
  );

  const text =
    fullText || (finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '');

  const results = parseOcrJsonBatch(text, images.length);

  return {
    results,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}
