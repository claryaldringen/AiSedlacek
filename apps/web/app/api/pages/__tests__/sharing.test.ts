import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockPageFindUnique = vi.fn();
const mockPageUpdate = vi.fn();
const mockPublicSlugFindUnique = vi.fn();
const mockPublicSlugDeleteMany = vi.fn();
const mockPublicSlugCreate = vi.fn();

// tx object passed into $transaction callback
const txMock = {
  page: {
    update: (...args: unknown[]) => mockPageUpdate(...args),
    delete: vi.fn(),
  },
  publicSlug: {
    deleteMany: (...args: unknown[]) => mockPublicSlugDeleteMany(...args),
    create: (...args: unknown[]) => mockPublicSlugCreate(...args),
  },
};

const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: typeof txMock) => unknown) => {
  return cb(txMock);
});

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findUnique: (...args: unknown[]) => mockPageFindUnique(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
      delete: vi.fn(),
    },
    publicSlug: {
      findUnique: (...args: unknown[]) => mockPublicSlugFindUnique(...args),
      deleteMany: (...args: unknown[]) => mockPublicSlugDeleteMany(...args),
      create: (...args: unknown[]) => mockPublicSlugCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/adapters/storage/local-storage', () => ({
  LocalStorageProvider: class {
    delete = vi.fn().mockResolvedValue(undefined);
  },
}));

// ── Helpers ──────────────────────────────────────────────

function makeRequest(id: string, method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new Request(`http://localhost/api/pages/${id}`, init));
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const FAKE_PAGE = {
  id: 'page-1',
  userId: 'test-user-id',
  imageUrl: '/api/images/abc-123.jpg',
  displayName: 'Ukázkový dokument',
  order: 0,
  status: 'pending',
  collectionId: null,
  isPublic: false,
  slug: null,
  createdAt: new Date().toISOString(),
};

// ── Import route handlers (after mocks) ──────────────────

import { PATCH as updatePage } from '@/app/api/pages/[id]/route';

// ── Tests ────────────────────────────────────────────────

describe('PATCH /api/pages/[id] – sharing fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPageFindUnique.mockResolvedValue(FAKE_PAGE);
    mockPublicSlugFindUnique.mockResolvedValue(null); // no existing slug
    mockPublicSlugDeleteMany.mockResolvedValue({ count: 0 });
    mockPublicSlugCreate.mockResolvedValue({});
    mockPageUpdate.mockResolvedValue({ ...FAKE_PAGE, isPublic: true, slug: 'ukazk-dokument' });
    mockTransaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  it('{ isPublic: true } alone returns 200 and does NOT return 400 "Nic k aktualizaci"', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeUndefined();
  });

  it('{ isPublic: false } alone returns 200 and clears slug', async () => {
    mockPageUpdate.mockResolvedValue({ ...FAKE_PAGE, isPublic: false, slug: null });

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: false }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
    const updateCall = mockPageUpdate.mock.calls[0]?.[0] as { data: { slug: unknown } } | undefined;
    expect(updateCall?.data.slug).toBeNull();
  });

  it('auto-generates slug from displayName when isPublic: true', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    // Should have called transaction
    expect(mockTransaction).toHaveBeenCalled();
    // Should have created a PublicSlug
    expect(mockPublicSlugCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: 'page',
          targetId: 'page-1',
        }),
      }),
    );
  });

  it('auto-generates fallback slug when page has no displayName', async () => {
    mockPageFindUnique.mockResolvedValue({ ...FAKE_PAGE, displayName: null });

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    // Slug should be generated from 'page-' + first 8 chars of id
    expect(mockPublicSlugCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: expect.stringMatching(/^page-/),
          targetType: 'page',
          targetId: 'page-1',
        }),
      }),
    );
  });

  it('uses provided slug when isPublic: true and valid slug given', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true, slug: 'moje-stranka' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    expect(mockPublicSlugCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'moje-stranka',
          targetType: 'page',
          targetId: 'page-1',
        }),
      }),
    );
  });

  it('returns 400 when slug is too short (invalid)', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true, slug: 'ab' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Slug musí mít alespoň/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when slug contains invalid characters', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true, slug: 'Invalid Slug!' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Slug může obsahovat pouze/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 409 when slug already taken (P2002 unique constraint)', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mockTransaction.mockRejectedValueOnce(p2002Error);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true, slug: 'obsazeny-slug' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Tento slug je již obsazený');
  });

  it('deletes old PublicSlug before creating new one in transaction', async () => {
    await updatePage(
      makeRequest('page-1', 'PATCH', { isPublic: true, slug: 'novy-slug' }),
      routeContext('page-1'),
    );

    expect(mockPublicSlugDeleteMany).toHaveBeenCalledWith({ where: { targetId: 'page-1' } });
    expect(mockPublicSlugCreate).toHaveBeenCalled();
  });
});
