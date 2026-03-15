/**
 * DI container with provider switching logic.
 * Provides fail-fast validation and auto-detection from API keys.
 */

import type { OllamaConfig } from '@ai-sedlacek/shared';
import { OllamaVisionOcrEngine } from '@/lib/adapters/ocr/ollama-vision.js';
import { OllamaTranslator } from '@/lib/adapters/llm/ollama-translator.js';
import { OllamaLayoutClassifier } from '@/lib/adapters/llm/ollama-classifier.js';
import { ClaudeVisionOcrEngine } from '@/lib/adapters/ocr/claude-vision.js';
import { TranskribusOcrEngine } from '@/lib/adapters/ocr/transkribus.js';
import { ClaudeTranslator } from '@/lib/adapters/llm/claude-translator.js';
import { ClaudeLayoutClassifier } from '@/lib/adapters/llm/claude-classifier.js';
import { SharpPreprocessor } from '@/lib/adapters/preprocessing/sharp.js';
import { ProcessDocument } from '@/lib/use-cases/process-document.js';

/**
 * Creates a fully wired ProcessDocument pipeline using configured providers.
 * Supports 'ollama' provider (local dev) and 'claude' provider (production).
 */
export function createPipeline(): ProcessDocument {
  const provider = getLlmProvider();
  const preprocessor = new SharpPreprocessor();

  if (provider === 'ollama') {
    const config: OllamaConfig = {
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
      model: process.env['OLLAMA_MODEL'] ?? 'llama3.2-vision',
    };

    const engine = new OllamaVisionOcrEngine(config);
    const translator = new OllamaTranslator(config);
    const classifier = new OllamaLayoutClassifier(config);

    return new ProcessDocument(preprocessor, classifier, [engine], translator);
  }

  // Claude production path: ensemble of ClaudeVision + Transkribus
  const claudeEngine = new ClaudeVisionOcrEngine();
  const transkribusEngine = new TranskribusOcrEngine();
  const translator = new ClaudeTranslator();
  const classifier = new ClaudeLayoutClassifier();

  return new ProcessDocument(
    preprocessor,
    classifier,
    [claudeEngine, transkribusEngine],
    translator,
  );
}

/**
 * Resolves a provider value from environment configuration.
 *
 * @param envValue - Explicit value from environment (e.g. LLM_PROVIDER)
 * @param apiKey - API key that implies a specific provider if set
 * @param validValues - List of valid provider values
 * @param defaultProvider - Default provider when nothing is configured
 * @param apiKeyProvider - Provider to auto-select when apiKey is present
 */
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
    // Explicit provider set – validate it has the required key if applicable
    if (envValue === apiKeyProvider && !apiKey) {
      throw new Error(`Provider "${envValue}" requires an API key but none was provided.`);
    }
    return envValue;
  }

  // Auto-detect from API key presence
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
