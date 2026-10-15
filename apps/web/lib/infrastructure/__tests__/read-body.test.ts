import { describe, it, expect } from 'vitest';
import {
  MAX_JSON_BODY_BYTES,
  bodyErrorResponse,
  readBodyLimited,
  readJsonBody,
  readTextBody,
} from '../read-body';

// /api/* je mimo middleware, takže na tělo neplatí limit Nextu – nepřihlášené
// routy ho čtou přes read-body se stropem velikosti.

/** Request s tělem jako stream bez Content-Length (chunked); vrací i počet odeslaných bajtů. */
function streamingRequest(
  totalBytes: number,
  chunkBytes = 16 * 1024,
): { request: Request; sent: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunkBytes, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(0x61));
      sent += size;
    },
  });
  const request = new Request('http://localhost/api/x', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { request, sent: () => sent };
}

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('readBodyLimited', () => {
  it('returns the body when it fits', async () => {
    const bytes = await readBodyLimited(jsonRequest('{"a":1}'), 100);
    expect(new TextDecoder().decode(bytes!)).toBe('{"a":1}');
  });

  it('rejects a declared Content-Length over the limit without reading', async () => {
    const req = jsonRequest('{}', { 'content-length': String(10 * 1024 * 1024) });
    expect(await readBodyLimited(req, 1024)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it('stops reading a stream without Content-Length once the limit is exceeded', async () => {
    const { request, sent } = streamingRequest(5 * 1024 * 1024);
    expect(request.headers.get('content-length')).toBeNull();

    expect(await readBodyLimited(request, 64 * 1024)).toBeNull();
    // Čtení se přerušilo – zbytek těla se do paměti nenačetl.
    expect(sent()).toBeLessThan(5 * 1024 * 1024);
  });

  it('accepts a body of exactly the limit', async () => {
    const { request } = streamingRequest(1000);
    expect((await readBodyLimited(request, 1000))!.byteLength).toBe(1000);
  });

  it('returns an empty body for a request without one', async () => {
    const req = new Request('http://localhost/api/x', { method: 'POST' });
    expect((await readBodyLimited(req, 10))!.byteLength).toBe(0);
  });
});

describe('readJsonBody', () => {
  it('parses JSON within the default limit', async () => {
    expect(await readJsonBody(jsonRequest('{"email":"a@b.cz"}'))).toEqual({
      ok: true,
      value: { email: 'a@b.cz' },
    });
  });

  it('reports invalid and empty JSON like request.json()', async () => {
    expect(await readJsonBody(jsonRequest('{nope'))).toEqual({ ok: false, error: 'invalid' });
    expect(await readJsonBody(jsonRequest(''))).toEqual({ ok: false, error: 'invalid' });
  });

  it('reports too_large over the default 64 kB limit', async () => {
    const big = JSON.stringify({ email: 'x'.repeat(MAX_JSON_BODY_BYTES) });
    expect(await readJsonBody(jsonRequest(big))).toEqual({ ok: false, error: 'too_large' });
  });
});

describe('readTextBody', () => {
  it('keeps the exact text (Stripe signs the raw body)', async () => {
    const raw = '{"id":"evt_1","note":"Příliš žluťoučký kůň"}\n';
    expect(await readTextBody(jsonRequest(raw), 1024)).toEqual({ ok: true, value: raw });
  });

  it('reports too_large over the limit', async () => {
    const { request } = streamingRequest(4096);
    expect(await readTextBody(request, 1024)).toEqual({ ok: false, error: 'too_large' });
  });
});

describe('bodyErrorResponse', () => {
  const t = (key: string): string => `t:${key}`;

  it('maps too_large to 413 and invalid to 400', async () => {
    const tooLarge = bodyErrorResponse('too_large', t);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 't:requestTooLarge' });

    const invalid = bodyErrorResponse('invalid', t);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 't:invalidJson' });
  });
});
