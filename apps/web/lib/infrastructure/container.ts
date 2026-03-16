/**
 * DI container – creates the processing pipeline.
 * Supports 'ollama' (local dev) and 'claude' (production) providers.
 */

import type { OllamaConfig } from '@ai-sedlacek/shared';
import { OllamaVisionOcrEngine } from '@/lib/adapters/ocr/ollama-vision';
import { ClaudeVisionOcrEngine } from '@/lib/adapters/ocr/claude-vision';
import { ProcessDocument } from '@/lib/use-cases/process-document';

export function createPipeline(): ProcessDocument {
  const provider = getLlmProvider();

  if (provider === 'ollama') {
    const config: OllamaConfig = {
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
      model: process.env['OLLAMA_MODEL'] ?? 'llama3.2-vision:11b',
    };
    return new ProcessDocument(new OllamaVisionOcrEngine(config));
  }

  return new ProcessDocument(new ClaudeVisionOcrEngine());
}

export function resolveProvider(
  envValue: string | undefined,
  apiKey: string | undefined,
  validValues: string[],
  defaultProvider: string,
  apiKeyProvider: string,
): string {
  if (envValue !== undefined) {
    if (!validValues.includes(envValue)) {
      throw new Error(
        `Invalid provider value "${envValue}". Valid values: ${validValues.join(', ')}`,
      );
    }
    if (envValue === apiKeyProvider && !apiKey) {
      throw new Error(`Provider "${envValue}" requires an API key but none was provided.`);
    }
    return envValue;
  }

  if (apiKey) {
    return apiKeyProvider;
  }

  return defaultProvider;
}

export function getLlmProvider(): 'ollama' | 'claude' {
  return resolveProvider(
    process.env['LLM_PROVIDER'],
    process.env['ANTHROPIC_API_KEY'],
    ['ollama', 'claude'],
    'ollama',
    'claude',
  ) as 'ollama' | 'claude';
}

export function getStorageProvider(): 'local' | 'vercel-blob' {
  return resolveProvider(
    process.env['STORAGE_PROVIDER'],
    process.env['BLOB_READ_WRITE_TOKEN'],
    ['local', 'vercel-blob'],
    'local',
    'vercel-blob',
  ) as 'local' | 'vercel-blob';
}
