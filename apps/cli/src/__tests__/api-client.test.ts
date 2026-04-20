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
});
