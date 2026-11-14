import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildAuthUrl, createPkcePair, exchangeCode, parseCallback } from '../lib/login-flow.js';

describe('ais login – PKCE a jednorázový kód (0.3.0)', () => {
  it('výzva je base64url SHA-256 ověřovače, ověřovač má 256 bitů', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(createPkcePair().verifier).not.toBe(verifier);
  });

  it('autorizační URL nese výzvu s metodou S256, ověřovač ne', () => {
    const { verifier, challenge } = createPkcePair();
    const url = new URL(
      buildAuthUrl('https://aisedlacek.com', 'st', 'http://127.0.0.1:5000/callback', challenge),
    );
    expect(url.pathname).toBe('/auth/cli');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect')).toBe('http://127.0.0.1:5000/callback');
    expect(url.href).not.toContain(verifier);
  });

  describe('parseCallback', () => {
    const cb = (q: string): URL => new URL(`http://localhost/callback?${q}`);

    it('nový server předá kód', () => {
      expect(parseCallback(cb('state=s&code=abc'), 's')).toEqual({ kind: 'code', code: 'abc' });
    });

    it('starší server předá token – CLI ho přijme', () => {
      expect(parseCallback(cb('state=s&token=tok'), 's')).toEqual({ kind: 'token', token: 'tok' });
    });

    it('cizí state se ignoruje (přihlášení nespadne)', () => {
      expect(parseCallback(cb('state=x&code=abc'), 's')).toEqual({ kind: 'ignore' });
    });

    it('bez kódu i tokenu chyba', () => {
      expect(parseCallback(cb('state=s'), 's')).toEqual({ kind: 'missing' });
    });
  });

  describe('exchangeCode', () => {
    it('pošle kód a ověřovač POSTem v těle a vrátí token', async () => {
      const fetchImpl = vi.fn(async () =>
        Response.json({ token: 't'.repeat(64) }, { status: 200 }),
      );

      const token = await exchangeCode(
        'https://aisedlacek.com',
        'c'.repeat(64),
        'verifier',
        fetchImpl as unknown as typeof fetch,
      );

      expect(token).toBe('t'.repeat(64));
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://aisedlacek.com/api/auth/cli/exchange');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        code: 'c'.repeat(64),
        codeVerifier: 'verifier',
      });
    });

    it('chyba serveru → srozumitelná výjimka', async () => {
      const fetchImpl = vi.fn(async () =>
        Response.json({ error: 'Neplatný nebo prošlý přihlašovací kód' }, { status: 400 }),
      );
      await expect(
        exchangeCode('https://aisedlacek.com', 'c', 'v', fetchImpl as unknown as typeof fetch),
      ).rejects.toThrow('Neplatný nebo prošlý přihlašovací kód');
    });

    it('token nikdy přes nezabezpečené HTTP (mimo localhost)', async () => {
      const fetchImpl = vi.fn();
      await expect(
        exchangeCode('http://example.com', 'c', 'v', fetchImpl as unknown as typeof fetch),
      ).rejects.toThrow('Nezabezpečené spojení');
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
