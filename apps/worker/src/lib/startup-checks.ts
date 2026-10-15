/**
 * Kontroly konfigurace při startu workeru (fail-fast).
 */

/**
 * SEC-12: režim `LLM_PROVIDER=claude-cli` je jen pro lokální vývoj. Spouští `claude`
 * CLI s nástrojem Read bez omezení cesty a s kompletním `process.env` – instrukce
 * vložené do dokumentu nebo kontextu svazku mohou model navést ke čtení `.env`
 * a obsah skončí v transkripci. Navíc se v něm účtuje 0 tokenů. V produkci proto
 * worker vůbec nenastartuje.
 */
export function assertLlmProviderAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'claude-cli') {
    throw new Error(
      'LLM_PROVIDER=claude-cli je v produkci zakázaný (SEC-12): CLI režim dává modelu ' +
        'přístup k souborovému systému serveru a neúčtuje tokeny. Nastavte ' +
        'LLM_PROVIDER=claude nebo proměnnou odeberte.',
    );
  }
}
