/**
 * CLI-based OCR processing using `claude` command.
 *
 * Pure transport adapter — uses the same prompts and message structure
 * as the API version (process.ts), only changes how messages are delivered.
 *
 * For local testing without API credits.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { TRANSLATE_ONLY_SYSTEM_PROMPT, BATCH_OCR_INSTRUCTION } from '@ai-sedlacek/shared';
import { parseOcrJson } from './parse';
import { SYSTEM_PROMPT } from './process';
import type { ProcessingMode, StructuredOcrResult } from './types';

const execFileAsync = promisify(execFile);

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

/**
 * Call claude CLI with given system prompt and user prompt.
 * Image is passed as a temp file path — CLI reads it via the Read tool.
 */
async function callCli(
  systemPrompt: string,
  userPrompt: string,
  imagePath: string,
): Promise<{ result: StructuredOcrResult; rawResponse: string }> {
  // Prepend image read instruction — this is the only CLI-specific part
  const prompt = `First, read the image file at ${imagePath}. Then:\n\n${userPrompt}`;

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

  console.log(`[CLI:OCR] Processing image...`);

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

  let result: StructuredOcrResult;
  if (parsed.structured_output) {
    result = parsed.structured_output;
  } else if (parsed.result) {
    result = parseOcrJson(parsed.result);
  } else {
    throw new Error('CLI returned no result');
  }

  return { result, rawResponse: JSON.stringify(result) };
}

/**
 * Save buffer to a temp file and return the path.
 */
async function saveTempImage(image: Buffer): Promise<string> {
  const ext = detectExtension(image);
  const tmpPath = join(tmpdir(), `ocr-${randomUUID()}.${ext}`);
  await writeFile(tmpPath, image);
  return tmpPath;
}

/**
 * Single-image OCR via CLI. Same interface as processWithClaude().
 * Uses the same system prompt and user message construction.
 */
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
  const tmpPath = await saveTempImage(image);

  try {
    // Build user prompt — same structure as process.ts
    let fullPrompt = '';
    if (previousContext) {
      fullPrompt += `Kontext z předchozích stránek rukopisu:\n${previousContext}\n\n`;
    }
    fullPrompt += userPrompt;

    // Same system prompt selection as process.ts
    const systemPrompt = mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT;

    onProgress?.(0, estimated);

    const { result, rawResponse } = await callCli(systemPrompt, fullPrompt, tmpPath);

    onProgress?.(estimated, estimated);

    return {
      result,
      rawResponse,
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
 * Batch OCR via CLI — processes images one at a time (sequential).
 * Same interface as processWithClaudeBatch(). Uses same prompt construction.
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
    // Build user prompt — same text blocks as process.ts batch version
    let fullPrompt = '';
    if (options?.previousContext) {
      fullPrompt += `Kontext z předchozích stránek rukopisu:\n${options.previousContext}\n\n`;
    }
    if (options?.collectionContext) {
      fullPrompt += `Kontext díla (použij pro lepší porozumění dokumentu):\n${options.collectionContext}\n\n`;
    }
    fullPrompt += userPrompt;

    // Same system prompt as batch API version (includes BATCH_OCR_INSTRUCTION
    // for consistency, though with single image it's not strictly needed)
    const systemPrompt =
      (options?.mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT) +
      '\n\n' +
      BATCH_OCR_INSTRUCTION;

    const tmpPath = await saveTempImage(img.buffer);
    try {
      const { result } = await callCli(systemPrompt, fullPrompt, tmpPath);
      results.push({ index: img.index, result });
      completedTokens += perImageEstimated;
      options?.onProgress?.(completedTokens, totalEstimated);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
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
