import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from '../lib/api-client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('api-client', () => {
  let api: ReturnType<typeof createApiClient>;

  beforeEach(() => {
    mockFetch.mockReset();
    api = createApiClient('https://sedlacek.ai', 'test-token');
  });

  it('sends GET with auth header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const result = await api.get('/api/pages');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sedlacek.ai/api/pages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('sends POST JSON with auth header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: '1' })));
    const result = await api.postJson('/api/collections', { name: 'Test' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sedlacek.ai/api/collections',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result).toEqual({ id: '1' });
  });

  it('throws on 401', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    await expect(api.get('/api/pages')).rejects.toThrow('Nejste přihlášen');
  });

  it('throws on server error', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    await expect(api.get('/api/pages/999')).rejects.toThrow('Not found');
  });

  it('uses a generic message when an error response is not JSON', async () => {
    mockFetch.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(api.patchJson('/api/documents/1', {})).rejects.toMatchObject({
      status: 502,
      message: 'Server vrátil 502',
    });
  });

  it('throws on a 2xx response that is not JSON (e.g. HTML login page)', async () => {
    mockFetch.mockResolvedValue(
      new Response('<!doctype html><title>Login</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(api.patchJson('/api/documents/1', { transcription: 'x' })).rejects.toThrow(
      /očekáván JSON/,
    );
  });

  it('accepts 204 No Content', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete('/api/collections/1')).resolves.toBeNull();
  });

  it('returns JSON null body as null', async () => {
    mockFetch.mockResolvedValue(new Response('null', { status: 200 }));
    await expect(api.get('/api/documents/1')).resolves.toBeNull();
  });

  it('refuses to create client with token over plaintext http (non-localhost)', () => {
    expect(() => createApiClient('http://example.com', 'test-token')).toThrow(/Nezabezpečené/);
  });

  it('allows plaintext http on localhost for dev', () => {
    expect(() => createApiClient('http://localhost:3000', 'test-token')).not.toThrow();
    expect(() => createApiClient('http://127.0.0.1:3000', 'test-token')).not.toThrow();
  });
});
