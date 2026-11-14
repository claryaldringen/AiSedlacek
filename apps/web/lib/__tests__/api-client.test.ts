import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from '../infrastructure/api-client';

// Chat (DocumentChat) volá API přes apiFetch: hlavička x-locale určuje jazyk hlášek
// API (např. 402 při nedostatku kreditu) a AbortSignal musí projít, aby šel
// stream zrušit.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('pošle x-locale podle jazyka v cestě a zachová signal i ostatní volby', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { pathname: '/cs/workspace' } });
    const controller = new AbortController();

    await apiFetch('/api/documents/doc-1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-locale')).toBe('cs');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.signal).toBe(controller.signal);
    expect(init.method).toBe('POST');
  });
});
