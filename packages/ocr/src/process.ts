import Anthropic from '@anthropic-ai/sdk';
import { BATCH_OCR_INSTRUCTION, TRANSLATE_ONLY_SYSTEM_PROMPT } from '@ai-sedlacek/shared';
import { parseOcrJson, parseOcrJsonBatch } from './parse';
import { prepareImage } from './prepare-image';
import type { ImageMediaType, ProcessingMode, StructuredOcrResult } from './types';

export const SYSTEM_PROMPT = `You are an expert in paleography and historical manuscripts. Transcribe the text from this manuscript. Use your knowledge of historical orthography to disambiguate unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then translate the transcribed text fully into the modern standard form of the language the user writes in. Do not summarize — translate the complete text. Preserve all references and citations. Use square brackets to clarify archaic terms or add context a modern reader would need. Then add a brief contextual explanation and a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text in markdown (use headings, bold for initials etc.). Rejoin words broken by line-end hyphens (e.g. 'prá-\\nvem' → 'právem'). Use paragraph breaks, not line-for-line breaks from the source layout.",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation in markdown (preserve structure and headings, use paragraph breaks, not line-for-line breaks)",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "page-specific context only: identify biblical quotes, literary references, named persons, places, or events mentioned on THIS page. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context. Focus on what helps the reader understand this specific page.",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}

Use \\n for newlines inside JSON strings. Return ONLY the JSON object, no markdown fences, no extra text.`;

/**
 * Rezerva výstupních tokenů na jednu stránku dávky. Hustá stránka (přepis, překlad,
 * kontext, glosář) má typicky 2 500–3 500 tokenů; 8 000 pokryje i výjimečně dlouhé
 * stránky. Platí se jen skutečně vygenerované tokeny, štědrý limit nic nestojí.
 */
export const BATCH_OUTPUT_TOKENS_PER_PAGE = 8_000;

/**
 * Strop `max_tokens` dávky. claude-opus-4-6 umí až 128k výstupních tokenů (jen se
 * streamingem, který používáme); volíme konzervativně polovinu. Dávka má podle
 * `createBatches` ve workeru max. ~6 stránek (6 × 8k = 48k) – výstup nad 64k by
 * spíš znamenal zacyklení modelu než legitimní obsah.
 */
export const BATCH_MAX_OUTPUT_TOKENS = 64_000;

/** `max_tokens` odvozený od skutečného počtu stránek v dávce (LLM-2). */
export function batchMaxTokens(pageCount: number): number {
  return Math.min(
    BATCH_MAX_OUTPUT_TOKENS,
    Math.max(8192, BATCH_OUTPUT_TOKENS_PER_PAGE * Math.max(1, pageCount)),
  );
}

export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  estimatedOutputTokens?: number,
  previousContext?: string,
  mode: ProcessingMode = 'transcribe+translate',
  language?: string,
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
                  text: `${language === 'en' ? 'Context from previous pages of the manuscript:' : 'Kontext z předchozích stránek rukopisu:'}\n${previousContext}`,
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
    previousContext?: string;
    onProgress?: (outputTokens: number, estimatedTotal: number) => void;
    estimatedOutputTokens?: number;
    mode?: ProcessingMode;
    language?: string;
  },
): Promise<{
  results: { index: number; result: StructuredOcrResult }[];
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** `stop_reason` odpovědi API (např. `end_turn`, `max_tokens`). */
  stopReason: string | null;
  /** Výstup byl useknut limitem `max_tokens` – chybějící stránky nejsou kompletní. */
  truncated: boolean;
}> {
  const startTime = Date.now();
  const client = new Anthropic();

  // Obrázky se připravují postupně, ne paralelně – sharp dekóduje celý obrázek
  // do paměti a několik velkých skenů najednou zbytečně zvedá špičku (PERF-1).
  const preparedImages: ((typeof images)[number] & { mediaType: ImageMediaType })[] = [];
  for (const img of images) {
    const { buffer, mediaType } = await prepareImage(img.buffer);
    preparedImages.push({ ...img, buffer, mediaType });
  }

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
    const prefix =
      options?.language === 'en'
        ? 'Context from previous pages of the manuscript:'
        : 'Kontext z předchozích stránek rukopisu:';
    content.push({
      type: 'text',
      text: `${prefix}\n${options.previousContext}`,
    });
  }

  content.push({ type: 'text', text: userPrompt });

  const estimated = options?.estimatedOutputTokens ?? 2500 * images.length;
  let fullText = '';
  const maxTokens = batchMaxTokens(images.length);

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
      maxTokens,
    }),
  );

  const truncated = finalMessage.stop_reason === 'max_tokens';
  if (truncated) {
    console.warn(
      `[Claude Batch] Output truncated at max_tokens=${maxTokens} (${images.length} images) – incomplete pages will be reported as errors`,
    );
  }

  const text =
    fullText || (finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '');

  // Useknutý poslední řádek JSONL se nenaparsuje a parser ho zahodí – vrácené
  // výsledky jsou tedy jen kompletní stránky; o zbytku rozhodne volající.
  const results = parseOcrJsonBatch(text, images.length);

  return {
    results,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
    stopReason: finalMessage.stop_reason ?? null,
    truncated,
  };
}
