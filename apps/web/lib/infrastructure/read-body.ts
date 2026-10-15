/**
 * Čtení těla requestu se stropem velikosti.
 *
 * /api/* běží mimo middleware (kvůli uploadům skenů), takže na tělo neplatí
 * žádný limit Nextu a `request.json()` / `text()` / `formData()` načte do paměti
 * cokoli. Nepřihlášené routy (a upload) proto čtou tělo jen přes tyto funkce –
 * jinak by anonym gigabajtovým tělem shodil web proces na sdíleném VPS.
 */

import { NextResponse } from 'next/server';

/** Strop pro JSON těla formulářů (přihlášení, registrace, reset hesla, …). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type BodyReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'too_large' | 'invalid' };

/**
 * Načte tělo s limitem velikosti. Napřed odmítne deklarovaný `Content-Length`
 * nad limit (bez čtení), pak čte stream a při překročení čtení přeruší – platí
 * tak i pro chunked / HTTP/2 requesty bez `Content-Length`.
 *
 * @returns bajty těla, nebo `null`, když je tělo větší než `maxBytes`
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Tělo jako UTF-8 text (např. Stripe webhook – podpis se ověřuje nad syrovým tělem). */
export async function readTextBody(
  request: Request,
  maxBytes: number,
): Promise<BodyReadResult<string>> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readBodyLimited(request, maxBytes);
  } catch {
    // Klient spojení přerušil uprostřed těla.
    return { ok: false, error: 'invalid' };
  }
  if (bytes === null) return { ok: false, error: 'too_large' };
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

/** Tělo jako JSON; neplatný JSON (i prázdné tělo) → `invalid`, jako `request.json()`. */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<BodyReadResult<unknown>> {
  const text = await readTextBody(request, maxBytes);
  if (!text.ok) return text;
  try {
    return { ok: true, value: JSON.parse(text.value) as unknown };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

/** Odpověď na nepřečtené tělo: 413 při překročení limitu, jinak 400 (neplatný JSON). */
export function bodyErrorResponse(
  error: 'too_large' | 'invalid',
  t: (key: 'requestTooLarge' | 'invalidJson') => string,
): NextResponse {
  return error === 'too_large'
    ? NextResponse.json({ error: t('requestTooLarge') }, { status: 413 })
    : NextResponse.json({ error: t('invalidJson') }, { status: 400 });
}
