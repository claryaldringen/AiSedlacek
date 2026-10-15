import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import cs from '@/messages/cs.json';

// Import z URL (CLI `ais upload <url>`) a detekce prázdných stránek dekódují
// obrázky sharpem ve web procesu – musí sdílet semafor withSharpLimit a import
// má strop počtu URL v jednom requestu.

// ── Mocks ────────────────────────────────────────────────

const mockPageFindFirst = vi.fn();
const mockPageFindMany = vi.fn();
const mockPageCreate = vi.fn();
const mockPageUpdate = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findFirst: (...args: unknown[]) => mockPageFindFirst(...args),
      findMany: (...args: unknown[]) => mockPageFindMany(...args),
      create: (...args: unknown[]) => mockPageCreate(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
    },
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  resolveUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/infrastructure/authz', () => ({ getOwnedCollection: vi.fn() }));

const mockStorageRead = vi.fn();
vi.mock('@/lib/adapters/storage', () => ({
  getStorage: () => ({
    upload: vi.fn().mockResolvedValue({ url: '/uploads/stored.png' }),
    read: (...args: unknown[]) => mockStorageRead(...args),
  }),
  storageKeyFromImageUrl: (url: string) => url,
}));
vi.mock('@/lib/infrastructure/thumbnails', () => ({
  saveThumbnail: vi.fn().mockResolvedValue('/uploads/thumb.jpg'),
}));

const mockSafeFetch = vi.fn();
vi.mock('@/lib/infrastructure/safe-fetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  readBodyWithLimit: async (res: Response) => Buffer.from(await res.arrayBuffer()),
}));

const mockValidateImage = vi.fn();
vi.mock('@/lib/infrastructure/image-validation', () => ({
  InvalidImageError: class InvalidImageError extends Error {},
  invalidImageMessage: () => 'invalid',
  validateImage: (...args: unknown[]) => mockValidateImage(...args),
}));

const mockIsBlankPage = vi.fn();
vi.mock('@/lib/infrastructure/blank-detection', () => ({
  isBlankPage: (...args: unknown[]) => mockIsBlankPage(...args),
}));

// Semafor sharpu: zaznamenáme, co běží uvnitř něj.
let insideSharpLimit = false;
const mockWithSharpLimit = vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
  insideSharpLimit = true;
  try {
    return await fn();
  } finally {
    insideSharpLimit = false;
  }
});
vi.mock('@/lib/infrastructure/sharp-limit', () => ({
  withSharpLimit: <T>(fn: () => Promise<T>) => mockWithSharpLimit(fn),
}));

import { POST as uploadUrl } from '@/app/api/pages/upload-url/route';
import { POST as detectBlank } from '@/app/api/pages/detect-blank/route';

// ── Helpers ──────────────────────────────────────────────

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-locale': 'cs' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insideSharpLimit = false;
  mockPageFindFirst.mockResolvedValue(null);
  mockPageCreate.mockImplementation(async ({ data }: { data: { filename: string } }) => ({
    id: 'page-1',
    filename: data.filename,
    status: 'pending',
  }));
  mockSafeFetch.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
  mockValidateImage.mockImplementation(async () => {
    expect(insideSharpLimit).toBe(true);
    return { extension: 'png', mimeType: 'image/png', width: 1, height: 1, thumbnail: {} };
  });
});

// ── POST /api/pages/upload-url ───────────────────────────

describe('POST /api/pages/upload-url – limits', () => {
  it('accepts up to 200 URLs', async () => {
    const urls = Array.from({ length: 200 }, (_, i) => `https://example.org/${i}.png`);

    const res = await uploadUrl(jsonRequest('/api/pages/upload-url', { urls }));

    expect(res.status).toBe(200);
    expect(mockSafeFetch).toHaveBeenCalledTimes(200);
  });

  it('rejects more than 200 URLs with 400 before downloading anything', async () => {
    const urls = Array.from({ length: 201 }, (_, i) => `https://example.org/${i}.png`);

    const res = await uploadUrl(jsonRequest('/api/pages/upload-url', { urls }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(cs.api.tooManyUrls.replace('{max}', '200'));
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('rejects non-string entries with 400', async () => {
    const res = await uploadUrl(
      jsonRequest('/api/pages/upload-url', { urls: ['https://example.org/a.png', { evil: 1 }] }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(cs.api.invalidUrl);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('decodes the downloaded image inside the shared sharp semaphore', async () => {
    const res = await uploadUrl(
      jsonRequest('/api/pages/upload-url', { urls: ['https://example.org/a.png'] }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).pages).toHaveLength(1);
    expect(mockWithSharpLimit).toHaveBeenCalledTimes(1);
    expect(mockValidateImage).toHaveBeenCalledTimes(1);
  });
});

// ── POST /api/pages/detect-blank ─────────────────────────

describe('POST /api/pages/detect-blank – sharp semaphore', () => {
  it('runs blank detection inside the shared sharp semaphore', async () => {
    mockPageFindMany.mockResolvedValue([{ id: 'page-1', imageUrl: '/uploads/a.png' }]);
    mockStorageRead.mockResolvedValue(Buffer.from([1]));
    mockIsBlankPage.mockImplementation(async () => {
      expect(insideSharpLimit).toBe(true);
      return true;
    });

    const res = await detectBlank(jsonRequest('/api/pages/detect-blank', { pageIds: ['page-1'] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ pageId: 'page-1', blank: true }] });
    expect(mockWithSharpLimit).toHaveBeenCalledTimes(1);
  });
});
