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

/** Sestaví cílovou adresu callbacku s tokenem a state (hodnoty se URL-enkódují). */
export function buildCliCallbackUrl(redirect: URL, token: string, state: string): string {
  const url = new URL(redirect.href);
  url.searchParams.set('token', token);
  url.searchParams.set('state', state);
  return url.href;
}
