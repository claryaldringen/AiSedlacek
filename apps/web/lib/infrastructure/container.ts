/**
 * DI container with provider switching logic.
 * Provides fail-fast validation and auto-detection from API keys.
 */

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
