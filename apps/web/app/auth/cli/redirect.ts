/**
 * Validace parametru `redirect` na stránce /auth/cli (SEC-5).
 *
 * Po kliknutí na „Povolit přístup" se vydá nový API token a prohlížeč se přesměruje
 * na `redirect` (`window.location.href`, kde React nechrání). Dřívější kontrola jen
 * podle hostname pustila i `javascript://localhost/...` a podobná schémata → DOM XSS
 * v originu aplikace ve chvíli, kdy existuje čerstvý token.
 *
 * Povolujeme výhradně to, co posílá `ais login`: `http:` na loopback s explicitním
 * portem a cestou `/callback`.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const CLI_CALLBACK_PATH = '/callback';

/** Vrátí naparsovanou URL, pokud je `redirect` bezpečná adresa callbacku CLI, jinak null. */
export function parseCliRedirect(redirect: string | null | undefined): URL | null {
  if (!redirect) return null;

  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:') return null;
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return null;
  // Explicitní port (CLI poslouchá na náhodném portu); výchozí port 80 URL parser vypustí.
  if (url.port === '' || Number(url.port) < 1) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== CLI_CALLBACK_PATH) return null;

  return url;
}

/**
 * PKCE výzva z `ais login` (CLI ≥ 0.3.0): `code_challenge` (base64url SHA-256,
 * 43 znaků) s metodou S256. Bez výzvy jde o starší CLI (≤ 0.2.0), kterému se
 * token předává postaru v URL. Výzva s jinou metodou nebo ve špatném tvaru je
 * neplatný požadavek (`invalid`).
 */
export function parseCodeChallenge(
  challenge: string | null | undefined,
  method: string | null | undefined,
): { kind: 'pkce'; challenge: string } | { kind: 'legacy' } | { kind: 'invalid' } {
  if (!challenge) return method ? { kind: 'invalid' } : { kind: 'legacy' };
  if (method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return { kind: 'invalid' };
  return { kind: 'pkce', challenge };
}

/**
 * Sestaví cílovou adresu callbacku (hodnoty se URL-enkódují). Novému CLI se
 * předává jen jednorázový kód (`code`), staršímu přímo token (`token`).
 */
export function buildCliCallbackUrl(
  redirect: URL,
  credential: { code: string } | { token: string },
  state: string,
): string {
  const url = new URL(redirect.href);
  // Hodnoty podvržené v redirect URL nesmí přežít ani vedle sebe
  url.searchParams.delete('code');
  url.searchParams.delete('token');
  if ('code' in credential) url.searchParams.set('code', credential.code);
  else url.searchParams.set('token', credential.token);
  url.searchParams.set('state', state);
  return url.href;
}
