import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import cs from '@/messages/cs.json';
import { pngClaimingSize } from '@/lib/infrastructure/__tests__/image-fixtures';

// SEC-1: every path that stores a user-supplied image (multipart upload, URL
// import, CLI upload-url) must decide the format from the CONTENT and store it
// as `<uuid>.<extension of the detected format>`.

// ── Mocks ────────────────────────────────────────────────

const mockPageFindFirst = vi.fn();
const mockPageCreate = vi.fn();
const mockPageAggregate = vi.fn();
const mockPageUpdate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findFirst: (...args: unknown[]) => mockPageFindFirst(...args),
      create: (...args: unknown[]) => mockPageCreate(...args),
      aggregate: (...args: unknown[]) => mockPageAggregate(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
    },
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  resolveUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockGetOwnedCollection = vi.fn();
vi.mock('@/lib/infrastructure/authz', () => ({
  getOwnedCollection: (...args: unknown[]) => mockGetOwnedCollection(...args),
}));

const mockUpload = vi.fn();
vi.mock('@/lib/adapters/storage', () => ({
  getStorage: () => ({ upload: (...args: unknown[]) => mockUpload(...args) }),
}));

const mockSafeFetch = vi.fn();
vi.mock('@/lib/infrastructure/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/infrastructure/safe-fetch')>()),
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

vi.mock('@/lib/infrastructure/prefetch-cache', () => ({
  getOrWait: vi.fn().mockResolvedValue(null),
}));

import { POST as upload } from '@/app/api/pages/upload/route';
import { POST as importUrl } from '@/app/api/pages/import-url/route';
import { POST as uploadUrl } from '@/app/api/pages/upload-url/route';

// ── Fixtures ─────────────────────────────────────────────

const HTML = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script>');
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
);
const CORRUPT_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), HTML]);

function image(format: 'png' | 'jpeg' | 'gif'): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: '#c8b48c' } })
    .toFormat(format)
    .toBuffer();
}

function file(content: Buffer, name: string, options?: FilePropertyBag): File {
  return new File([new Uint8Array(content)], name, options);
}

function uploadRequest(upload: File): NextRequest {
  const form = new FormData();
  form.append('files', upload);
  return new NextRequest('http://localhost/api/pages/upload', {
    method: 'POST',
    body: form,
    headers: { 'x-locale': 'cs' },
  });
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-locale': 'cs' },
  });
}

function remote(body: Buffer, headers: Record<string, string>): Response {
  return new Response(new Uint8Array(body), { status: 200, headers });
}

/** Extensions passed to storage.upload, in call order. */
function storedExtensions(): unknown[] {
  return mockUpload.mock.calls.map((call) => call[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  mockUpload.mockImplementation(async (_buf: Buffer, ext: string) => {
    n++;
    return { url: `/uploads/stored-${n}.${ext}`, path: `stored-${n}.${ext}` };
  });
  mockPageFindFirst.mockResolvedValue(null);
  mockPageCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'page-new',
    ...data,
  }));
  mockPageAggregate.mockResolvedValue({ _max: { order: null } });
  mockGetOwnedCollection.mockResolvedValue({ id: 'col-1' });
});

// ── POST /api/pages/upload ───────────────────────────────

describe('POST /api/pages/upload – content validation', () => {
  it('rejects HTML declared as image/jpeg and stores nothing', async () => {
    const res = await upload(uploadRequest(file(HTML, 'x.html', { type: 'image/jpeg' })));
    const json = await res.json();

    expect(json.pages).toEqual([]);
    expect(json.errors).toEqual([{ filename: 'x.html', error: cs.api.unsupportedFormat }]);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPageCreate).not.toHaveBeenCalled();
  });

  it('rejects SVG declared as image/png', async () => {
    const res = await upload(uploadRequest(file(SVG, 'scan.png', { type: 'image/png' })));
    const json = await res.json();

    expect(json.errors[0].error).toBe(cs.api.unsupportedFormat);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects an image that cannot be decoded', async () => {
    const res = await upload(uploadRequest(file(CORRUPT_JPEG, 'scan.jpg', { type: 'image/jpeg' })));
    const json = await res.json();

    expect(json.errors[0].error).toBe(cs.api.invalidImage);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPageCreate).not.toHaveBeenCalled();
  });

  it('rejects an image above the pixel limit (SEC-13)', async () => {
    const bomb = await pngClaimingSize(12_000, 12_000);
    const res = await upload(uploadRequest(file(bomb, 'bomb.png', { type: 'image/png' })));
    const json = await res.json();

    expect(json.errors[0].error).toBe(cs.api.imageTooManyPixels.replace('{max}', '100'));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('stores a PNG as .png even when the client name and type lie', async () => {
    const png = await image('png');
    const res = await upload(uploadRequest(file(png, 'scan.html', { type: 'text/html' })));
    const json = await res.json();

    expect(json.errors).toEqual([]);
    expect(storedExtensions()).toEqual(['png', 'jpg']); // original + JPEG thumbnail
    expect(mockUpload.mock.calls[0]![0]).toEqual(png);
    const data = mockPageCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      filename: 'scan.html', // display only
      imageUrl: '/uploads/stored-1.png',
      thumbnailUrl: '/uploads/stored-2.jpg',
      mimeType: 'image/png',
      width: 40,
      height: 30,
    });
  });

  it('accepts a file without MIME type (CLI sends a bare Blob)', async () => {
    const jpeg = await image('jpeg');
    const res = await upload(uploadRequest(file(jpeg, 'scan.jpg')));
    const json = await res.json();

    expect(json.errors).toEqual([]);
    expect(storedExtensions()[0]).toBe('jpg');
    expect(mockPageCreate.mock.calls[0]![0].data.mimeType).toBe('image/jpeg');
  });

  it('does not reuse a cross-user stored file with a non-image extension', async () => {
    mockPageFindFirst.mockImplementation(async ({ where }: { where: { userId?: string } }) =>
      where.userId ? null : { imageUrl: '/uploads/legacy-evil.html' },
    );
    const png = await image('png');
    await upload(uploadRequest(file(png, 'scan.png', { type: 'image/png' })));

    expect(storedExtensions()).toEqual(['png', 'jpg']);
    expect(mockPageCreate.mock.calls[0]![0].data.imageUrl).toBe('/uploads/stored-1.png');
  });

  it('reuses a cross-user stored file with an image extension', async () => {
    mockPageFindFirst.mockImplementation(async ({ where }: { where: { userId?: string } }) =>
      where.userId ? null : { imageUrl: '/uploads/legacy-scan.png' },
    );
    const png = await image('png');
    await upload(uploadRequest(file(png, 'scan.png', { type: 'image/png' })));

    expect(storedExtensions()).toEqual(['jpg']); // thumbnail only
    expect(mockPageCreate.mock.calls[0]![0].data.imageUrl).toBe('/uploads/legacy-scan.png');
  });
});

describe('POST /api/pages/upload – request size limits', () => {
  it('rejects a request whose declared body exceeds the limit before parsing it', async () => {
    const form = new FormData();
    form.append('files', file(HTML, 'x.jpg', { type: 'image/jpeg' }));
    const req = new NextRequest('http://localhost/api/pages/upload', {
      method: 'POST',
      body: form,
      headers: { 'x-locale': 'cs', 'content-length': String(500 * 1024 * 1024) },
    });

    const res = await upload(req);

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(cs.api.requestTooLarge);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects more than 5 files in one request', async () => {
    const form = new FormData();
    for (let i = 0; i < 6; i++)
      form.append('files', file(HTML, `${i}.jpg`, { type: 'image/jpeg' }));
    const req = new NextRequest('http://localhost/api/pages/upload', {
      method: 'POST',
      body: form,
      headers: { 'x-locale': 'cs' },
    });

    const res = await upload(req);

    expect(res.status).toBe(413);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ── POST /api/pages/import-url ───────────────────────────

describe('POST /api/pages/import-url – content validation', () => {
  it('rejects HTML served as image/jpeg and stores nothing', async () => {
    mockSafeFetch.mockResolvedValue(
      remote(HTML, {
        'content-type': 'image/jpeg',
        'content-disposition': 'attachment; filename="evil.html"',
      }),
    );
    const res = await importUrl(jsonRequest('/api/pages/import-url', { url: 'https://e.org/x' }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(cs.api.unsupportedFormat);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPageCreate).not.toHaveBeenCalled();
  });

  it('stores by detected format, ignoring Content-Type and Content-Disposition', async () => {
    const png = await image('png');
    mockSafeFetch.mockResolvedValue(
      remote(png, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="evil.svg"',
      }),
    );
    const res = await importUrl(jsonRequest('/api/pages/import-url', { url: 'https://e.org/x' }));

    expect(res.status).toBe(201);
    expect(storedExtensions()).toEqual(['png', 'jpg']);
    expect(mockPageCreate.mock.calls[0]![0].data).toMatchObject({
      filename: 'evil.svg', // display only
      imageUrl: '/uploads/stored-1.png',
      mimeType: 'image/png',
      width: 40,
      height: 30,
    });
  });

  it('still accepts GIF', async () => {
    mockSafeFetch.mockResolvedValue(remote(await image('gif'), { 'content-type': 'image/gif' }));
    const res = await importUrl(
      jsonRequest('/api/pages/import-url', { url: 'https://e.org/a.gif' }),
    );

    expect(res.status).toBe(201);
    expect(storedExtensions()[0]).toBe('gif');
  });

  it('checks the collection before writing anything to storage', async () => {
    mockGetOwnedCollection.mockResolvedValue(null);
    mockSafeFetch.mockResolvedValue(remote(await image('png'), { 'content-type': 'image/png' }));
    const res = await importUrl(
      jsonRequest('/api/pages/import-url', { url: 'https://e.org/a.png', collectionId: 'other' }),
    );

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ── POST /api/pages/upload-url (CLI) ─────────────────────

describe('POST /api/pages/upload-url – content validation', () => {
  it('rejects HTML served as image/png and stores nothing', async () => {
    mockSafeFetch.mockResolvedValue(remote(HTML, { 'content-type': 'image/png' }));
    const res = await uploadUrl(
      jsonRequest('/api/pages/upload-url', { urls: ['https://e.org/x.png'] }),
    );
    const json = await res.json();

    expect(json.pages).toEqual([]);
    expect(json.errors).toEqual([{ url: 'https://e.org/x.png', error: cs.api.unsupportedFormat }]);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('stores by detected format regardless of Content-Type', async () => {
    mockSafeFetch.mockResolvedValue(
      remote(await image('png'), { 'content-type': 'application/octet-stream' }),
    );
    const res = await uploadUrl(
      jsonRequest('/api/pages/upload-url', { urls: ['https://e.org/page.html'] }),
    );
    const json = await res.json();

    expect(json.errors).toEqual([]);
    expect(storedExtensions()).toEqual(['png', 'jpg']);
    expect(mockPageCreate.mock.calls[0]![0].data).toMatchObject({
      filename: 'page.html',
      imageUrl: '/uploads/stored-1.png',
      mimeType: 'image/png',
    });
  });
});
