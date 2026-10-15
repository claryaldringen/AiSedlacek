/**
 * Vrátí callbackUrl jen pokud jde o cestu v rámci této aplikace, jinak fallback.
 *
 * Kontrola `startsWith('/') && !startsWith('//')` nestačí: prohlížeč i WHATWG URL
 * normalizují `\` na `/`, takže `/\evil.com` se vyhodnotí jako `//evil.com`
 * (open redirect). Proto URL rozparsujeme a porovnáme origin.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  origin: string,
  fallback = '/workspace',
): string {
  if (!raw || !raw.startsWith('/')) return fallback;
  try {
    const base = new URL(origin);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Normalizace dot-segmentů umí z `/.//evil.com` udělat `//evil.com`, který
    // prohlížeč při navigaci čte jako scheme-relative URL na cizí host.
    // `/\` u http(s) dnes nenastane (WHATWG parser mění `\` na `/`) – záměrná
    // pojistka pro případ jiného parseru nebo schématu, nemazat.
    if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
