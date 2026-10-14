import { describe, it, expect } from 'vitest';
import { assertLlmProviderAllowed } from '../lib/startup-checks';

describe('assertLlmProviderAllowed (SEC-12)', () => {
  it('v produkci odmítne LLM_PROVIDER=claude-cli s jasnou hláškou', () => {
    expect(() =>
      assertLlmProviderAllowed({ NODE_ENV: 'production', LLM_PROVIDER: 'claude-cli' }),
    ).toThrow(/LLM_PROVIDER=claude-cli je v produkci zakázaný/);
  });

  it('v produkci povolí API režim i výchozí nastavení', () => {
    expect(() =>
      assertLlmProviderAllowed({ NODE_ENV: 'production', LLM_PROVIDER: 'claude' }),
    ).not.toThrow();
    expect(() => assertLlmProviderAllowed({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('mimo produkci CLI režim povolí (lokální vývoj)', () => {
    expect(() => assertLlmProviderAllowed({ LLM_PROVIDER: 'claude-cli' })).not.toThrow();
    expect(() =>
      assertLlmProviderAllowed({ NODE_ENV: 'development', LLM_PROVIDER: 'claude-cli' }),
    ).not.toThrow();
  });
});
