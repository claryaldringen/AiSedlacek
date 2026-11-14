/**
 * `ais login` – předání tokenu bez tokenu v URL (od verze 0.3.0).
 *
 * CLI pošle na autorizační stránku PKCE výzvu (S256). Prohlížeč pak na loopback
 * callback předá jen jednorázový, krátce platný kód; CLI ho POSTem vymění za token
 * a k výměně přiloží ověřovač, který nikdy neopustí tento proces. Token se tak
 * neobjeví v adrese ani v historii prohlížeče (RFC 8252 + RFC 7636).
 *
 * Token v callbacku CLI nepřijímá: podvržený callback s cizím tokenem by
 * uživatele přihlásil k cizímu účtu (login CSRF) a PKCE by nic nechránilo.
 * Server s výměnou kódu se nasazuje před vydáním této verze CLI.
 */
import * as crypto from 'node:crypto';
import { CLI_LOCALE, isSecureBaseUrl } from './api-client.js';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Ověřovač (43 znaků base64url = 256 bitů) a výzva base64url(SHA-256(ověřovač)). */
export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Adresa autorizační stránky s PKCE výzvou. */
export function buildAuthUrl(
  server: string,
  state: string,
  redirect: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    state,
    redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${server}/auth/cli?${params.toString()}`;
}

export type CallbackResult =
  /** Cizí požadavek (jiný state) – ignorovat a čekat dál. */
  | { kind: 'ignore' }
  /** Jednorázový kód k výměně za token. */
  | { kind: 'code'; code: string }
  /** Token místo kódu (starý tok nebo podvržený callback) – přihlášení odmítnout. */
  | { kind: 'token-rejected' }
  | { kind: 'missing' };

/** Vyhodnotí požadavek na loopback callback. */
export function parseCallback(url: URL, expectedState: string): CallbackResult {
  if (url.searchParams.get('state') !== expectedState) return { kind: 'ignore' };
  const code = url.searchParams.get('code');
  if (code) return { kind: 'code', code };
  if (url.searchParams.has('token')) return { kind: 'token-rejected' };
  return { kind: 'missing' };
}

/** Hláška, když server místo kódu poslal token (CLI ≥ 0.3.0 token z URL nepřijímá). */
export const TOKEN_CALLBACK_REJECTED =
  'Server předal token místo jednorázového kódu – přihlášení odmítnuto. ' +
  'Server zřejmě ještě nepodporuje bezpečné přihlášení; zkuste to později.';

/** Vymění jednorázový kód za API token (POST, ověřovač jen v těle požadavku). */
export async function exchangeCode(
  server: string,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // Token přijde v odpovědi – jen přes HTTPS (výjimka localhost pro vývoj)
  if (!isSecureBaseUrl(server)) {
    throw new Error(
      `Nezabezpečené spojení: ${server}. Přihlášení je možné jen přes HTTPS ` +
        `(výjimka: localhost pro vývoj).`,
    );
  }
  const res = await fetchImpl(`${server}/api/auth/cli/exchange`, {
    method: 'POST',
    // CLI mluví česky – chybové hlášky serveru ať přijdou česky
    headers: { 'Content-Type': 'application/json', 'x-locale': CLI_LOCALE },
    body: JSON.stringify({ code, codeVerifier: verifier }),
  });
  const body = (await res.json().catch(() => null)) as { token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof body?.token !== 'string') {
    const msg = typeof body?.error === 'string' ? body.error : `Server vrátil ${res.status}`;
    throw new Error(`Výměna přihlašovacího kódu selhala: ${msg}`);
  }
  return body.token;
}
