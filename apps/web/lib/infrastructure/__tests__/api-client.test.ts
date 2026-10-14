import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetchOk, ApiError } from '../api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetchOk', () => {
  it('returns the response for 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));

    const res = await apiFetchOk('/api/x');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('throws ApiError with the server message for non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"Stránka nenalezena"}', { status: 404 })),
    );

    const err = await apiFetchOk('/api/x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe('Stránka nenalezena');
  });

  it('falls back to HTTP status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));

    await expect(apiFetchOk('/api/x')).rejects.toThrow('HTTP 502');
  });
});
