/**
 * CLI-based OCR processing using `claude` command.
 *
 * For local testing without API credits. Processes one image at a time
 * (no batch optimization) using Claude CLI with Read tool for image access.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { TRANSLATE_ONLY_SYSTEM_PROMPT } from '@ai-sedlacek/shared';
import { parseOcrJson } from './parse';
import type { ProcessingMode, StructuredOcrResult } from './types';

const execFileAsync = promisify(execFile);

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

const OCR_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    transcription: { type: 'string', description: 'Original text transcription in markdown' },
    detectedLanguage: { type: 'string', description: 'ISO language code, e.g. cs-old, de-old, la' },
    translation: { type: 'string', description: 'Full translation in markdown' },
    translationLanguage: { type: 'string', description: 'ISO code of translation language' },
    context: { type: 'string', description: 'Page-specific context only' },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          definition: { type: 'string' },
        },
        required: ['term', 'definition'],
      },
    },
  },
  required: [
    'transcription',
    'detectedLanguage',
    'translation',
    'translationLanguage',
    'context',
    'glossary',
  ],
});

export async function processWithClaudeCli(
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
  const estimated = estimatedOutputTokens ?? 1500;

  // Save image to temp file so CLI can read it
  const ext = detectExtension(image);
  const tmpPath = join(tmpdir(), `ocr-${randomUUID()}.${ext}`);
  await writeFile(tmpPath, image);

  try {
    // Build prompt that instructs CLI to read the image
    let prompt = `First, read the image file at ${tmpPath}. Then analyze the historical manuscript in the image.\n\n`;

    if (previousContext) {
      prompt += `Context from previous manuscript pages:\n${previousContext}\n\n`;
    }

    prompt += userPrompt;

    const systemPrompt = mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT;

    const args = [
      '--bare',
      '-p',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      OCR_JSON_SCHEMA,
      '--system-prompt',
      systemPrompt,
      '--allowedTools',
      'Read',
      '--max-turns',
      '3',
    ];

    onProgress?.(0, estimated);
    console.log(`[CLI:OCR] Processing image (${(image.length / 1024).toFixed(0)} KB)...`);

    const { stdout } = await execFileAsync('claude', args, {
      timeout: 600_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });

    const parsed = JSON.parse(stdout) as {
      result?: string;
      structured_output?: StructuredOcrResult;
      cost_usd?: number;
      duration_ms?: number;
    };

    console.log('[CLI:OCR] Done:', {
      cost_usd: parsed.cost_usd,
      duration_ms: parsed.duration_ms,
    });

    // structured_output is set when --json-schema is used
    let result: StructuredOcrResult;
    if (parsed.structured_output) {
      result = parsed.structured_output;
    } else if (parsed.result) {
      // Fallback: parse the text result
      result = parseOcrJson(parsed.result);
    } else {
      throw new Error('CLI returned no result');
    }

    onProgress?.(estimated, estimated);

    return {
      result,
      rawResponse: JSON.stringify(result),
      processingTimeMs: Date.now() - startTime,
      model: 'claude-cli',
      inputTokens: 0,
      outputTokens: 0,
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * CLI batch processing — processes images one at a time in sequence.
 * No actual batching (unlike the API version), but maintains the same interface.
 */
export async function processWithClaudeBatchCli(
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
  const totalEstimated = options?.estimatedOutputTokens ?? 2500 * images.length;
  const perImageEstimated = Math.round(totalEstimated / images.length);
  const results: { index: number; result: StructuredOcrResult }[] = [];
  let completedTokens = 0;

  for (const img of images) {
    // Include collection context in the prompt for each image
    let fullPrompt = userPrompt;
    if (options?.collectionContext) {
      fullPrompt = `Context of the work:\n${options.collectionContext}\n\n---\n\n${userPrompt}`;
    }

    const { result } = await processWithClaudeCli(
      img.buffer,
      fullPrompt,
      (current) => {
        options?.onProgress?.(completedTokens + current, totalEstimated);
      },
      perImageEstimated,
      options?.previousContext,
      options?.mode,
    );

    results.push({ index: img.index, result });
    completedTokens += perImageEstimated;
  }

  return {
    results,
    rawResponse: results.map((r) => JSON.stringify(r.result)).join('\n'),
    processingTimeMs: Date.now() - startTime,
    model: 'claude-cli',
    inputTokens: 0,
    outputTokens: 0,
  };
}

function detectExtension(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'webp';
  return 'jpg';
}
