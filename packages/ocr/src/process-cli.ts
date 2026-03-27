/**
 * CLI-based OCR processing using `claude` command.
 *
 * Pure transport adapter — uses the same prompts and message structure
 * as the API version (process.ts), only changes how messages are delivered.
 *
 * For local testing without API credits.
 */

import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { TRANSLATE_ONLY_SYSTEM_PROMPT, BATCH_OCR_INSTRUCTION } from '@ai-sedlacek/shared';
import { parseOcrJson } from './parse';
import { SYSTEM_PROMPT } from './process';
import type { ProcessingMode, StructuredOcrResult } from './types';

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
 *
 * All long strings (prompt, system prompt, JSON schema) are written to temp files
 * to avoid ARG_MAX limits. The prompt is piped via stdin.
 */
async function callCli(
  systemPrompt: string,
  userPrompt: string,
  imagePath: string,
): Promise<{ result: StructuredOcrResult; rawResponse: string }> {
  // Prepend image read instruction — this is the only CLI-specific part
  const prompt = `First, read the image file at ${imagePath}. Then:\n\n${userPrompt}`;

  const tmpFiles: string[] = [];
  try {
    // --max-turns 5: Read tool for image (1-2 turns) + structured output via tool_use (1 turn) + buffer
    const args = [
      '--output-format',
      'json',
      '--allowedTools',
      'Read',
      '--max-turns',
      '5',
    ];

    // Write system prompt to temp file
    const sysFile = join(tmpdir(), `ocr-sys-${randomUUID()}.txt`);
    await writeFile(sysFile, systemPrompt);
    tmpFiles.push(sysFile);
    args.push('--system-prompt-file', sysFile);

    // JSON schema as argument (small enough to not hit ARG_MAX)
    args.push('--json-schema', OCR_JSON_SCHEMA);

    // Write user prompt to temp file (piped via stdin)
    const promptFile = join(tmpdir(), `ocr-prompt-${randomUUID()}.txt`);
    await writeFile(promptFile, prompt);
    tmpFiles.push(promptFile);

    console.log(`[CLI:OCR] Processing image...`);

    const stdout = await spawnCli(args, promptFile);

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
  } finally {
    await Promise.all(tmpFiles.map((f) => unlink(f).catch(() => {})));
  }
}

/**
 * Spawn claude CLI, piping the prompt file content via stdin.
 * Returns stdout. Rejects on non-zero exit or timeout (10 min for OCR).
 */
function spawnCli(args: string[], promptFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullCmd = `cat "${promptFile}" | claude ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

    const child = spawn('sh', ['-c', fullCmd], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude CLI timed out after 10 minutes'));
    }, 600_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.slice(0, 500);
        reject(new Error(`claude CLI exited with code ${code}: ${detail}`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
