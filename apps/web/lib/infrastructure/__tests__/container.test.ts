import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLlmProvider, getStorageProvider, resolveProvider } from '../container.js';

describe('resolveProvider', () => {
  it('returns explicit ollama when set', () => {
    const result = resolveProvider('ollama', undefined, ['ollama', 'claude'], 'ollama', 'claude');
    expect(result).toBe('ollama');
  });

  it('returns explicit claude when set with API key', () => {
    const result = resolveProvider('claude', 'sk-test', ['ollama', 'claude'], 'ollama', 'claude');
    expect(result).toBe('claude');
  });

  it('throws when claude is set but API key is missing', () => {
    expect(() =>
      resolveProvider('claude', undefined, ['ollama', 'claude'], 'ollama', 'claude'),
    ).toThrow();
  });

  it('throws when an invalid value is provided', () => {
    expect(() =>
      resolveProvider('invalid', undefined, ['ollama', 'claude'], 'ollama', 'claude'),
    ).toThrow();
  });

  it('auto-detects claude when API key is present and no explicit value', () => {
    const result = resolveProvider(undefined, 'sk-test', ['ollama', 'claude'], 'ollama', 'claude');
    expect(result).toBe('claude');
  });

  it('returns default ollama when no env var and no API key', () => {
    const result = resolveProvider(undefined, undefined, ['ollama', 'claude'], 'ollama', 'claude');
    expect(result).toBe('ollama');
  });
});

describe('getLlmProvider', () => {
  beforeEach(() => {
    delete process.env['LLM_PROVIDER'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    delete process.env['LLM_PROVIDER'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('defaults to ollama when no env vars set', () => {
    expect(getLlmProvider()).toBe('ollama');
  });

  it('returns claude when ANTHROPIC_API_KEY is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    expect(getLlmProvider()).toBe('claude');
  });
});

describe('getStorageProvider', () => {
  beforeEach(() => {
    delete process.env['STORAGE_PROVIDER'];
    delete process.env['BLOB_READ_WRITE_TOKEN'];
  });

  afterEach(() => {
    delete process.env['STORAGE_PROVIDER'];
    delete process.env['BLOB_READ_WRITE_TOKEN'];
  });

  it('defaults to local when no env vars set', () => {
    expect(getStorageProvider()).toBe('local');
  });

  it('returns vercel-blob when BLOB_READ_WRITE_TOKEN is set', () => {
    process.env['BLOB_READ_WRITE_TOKEN'] = 'vercel_blob_rw_test';
    expect(getStorageProvider()).toBe('vercel-blob');
  });
});
