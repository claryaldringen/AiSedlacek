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
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
