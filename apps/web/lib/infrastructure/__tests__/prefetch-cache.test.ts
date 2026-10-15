import { describe, it, expect, vi, beforeEach } from 'vitest';

// SEC-14: background prefetch must not buffer an unbounded amount of data.

const mockSafeFetch = vi.fn();
vi.mock('../safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../safe-fetch')>()),
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

type PrefetchModule = typeof import('../prefetch-cache');

async function freshModule(): Promise<PrefetchModule> {
  vi.resetModules(); // the cache and in-flight map are module state
  return import('../prefetch-cache');
}

function imageResponse(bytes: number): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}

beforeEach(() => {
  mockSafeFetch.mockReset();
});

describe('prefetch', () => {
  it('limits the number of downloads in flight at once', async () => {
    const { prefetch } = await freshModule();
    const release: Array<(res: Response) => void> = [];
    mockSafeFetch.mockImplementation(
      () => new Promise<Response>((resolve) => release.push(resolve)),
    );

    for (let i = 0; i < 50; i++) prefetch(`https://e.org/page-${i}.jpg`);

    expect(mockSafeFetch.mock.calls.length).toBe(4);
    for (const resolve of release) resolve(imageResponse(10));
  });

  it('frees a slot once a download finishes', async () => {
    const { prefetch, getOrWait } = await freshModule();
    mockSafeFetch.mockImplementation(async () => imageResponse(10));

    for (let i = 0; i < 4; i++) prefetch(`https://e.org/page-${i}.jpg`);
    await Promise.all([0, 1, 2, 3].map((i) => getOrWait(`https://e.org/page-${i}.jpg`)));
    prefetch('https://e.org/page-4.jpg');

    expect(mockSafeFetch.mock.calls.length).toBe(5);
  });

  it('does not cache a response larger than the upload limit', async () => {
    const { prefetch, getOrWait } = await freshModule();
    mockSafeFetch.mockImplementation(async () => imageResponse(21 * 1024 * 1024));

    prefetch('https://e.org/huge.jpg');

    const entry = await getOrWait('https://e.org/huge.jpg');
    // Compare the size only – a failing diff of a 21 MB Buffer exhausts the heap.
    expect(entry?.buffer.length ?? null).toBeNull();
  });
});
