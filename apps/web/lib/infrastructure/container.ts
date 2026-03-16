/**
 * DI container – simplified pipeline.
 * Claude Opus 4.6 handles OCR + translation + context in one call.
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
