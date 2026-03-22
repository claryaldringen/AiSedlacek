import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// -- Mocks ---------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockPublicSlugFindUnique = vi.fn();
const mockPublicSlugDeleteMany = vi.fn();
const mockPublicSlugCreate = vi.fn();

// tx object passed into $transaction callback
const txMock = {
  collection: {
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: vi.fn(),
  },
  publicSlug: {
    deleteMany: (...args: unknown[]) => mockPublicSlugDeleteMany(...args),
    create: (...args: unknown[]) => mockPublicSlugCreate(...args),
  },
  workspace: {
    upsert: vi.fn().mockResolvedValue({ id: 'public-workspace' }),
  },
  workspaceItem: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'wi-1' }),
  },
};

const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: typeof txMock) => unknown) => {
  return cb(txMock);
});

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
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

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));

vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(),
}));

// -- Helpers --------------------------------------------------------------

function makeRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new Request(url, init));
}

const routeContext = { params: Promise.resolve({ id: 'col-1' }) };

const FAKE_COLLECTION = {
  id: 'col-1',
  userId: 'test-user-id',
  name: 'Testovaci svazek',
  description: 'Popis svazku',
  isPublic: false,
  slug: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// -- Import route handlers (after mocks) ----------------------------------

import { PATCH as updateCollection } from '@/app/api/collections/[id]/route';

// -- Tests ----------------------------------------------------------------

describe('PATCH /api/collections/[id] – sharing fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(FAKE_COLLECTION);
    mockPublicSlugFindUnique.mockResolvedValue(null); // no existing slug
    mockPublicSlugDeleteMany.mockResolvedValue({ count: 0 });
    mockPublicSlugCreate.mockResolvedValue({});
    mockUpdate.mockResolvedValue({ ...FAKE_COLLECTION, isPublic: true, slug: 'testovaci-svazek' });
    mockTransaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  it('{ isPublic: true } alone returns 200 and does NOT return 400 "Nic k aktualizaci"', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeUndefined();
  });

  it('{ isPublic: false } alone returns 200 and clears slug', async () => {
    mockUpdate.mockResolvedValue({ ...FAKE_COLLECTION, isPublic: false, slug: null });

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: false,
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
    // slug should be set to null
    const updateCall = mockUpdate.mock.calls[0]?.[0] as { data: { slug: unknown } } | undefined;
    expect(updateCall?.data.slug).toBeNull();
  });

  it('auto-generates slug when isPublic: true and no slug provided', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
    });
    await updateCollection(req, routeContext);

    // Should have called transaction
    expect(mockTransaction).toHaveBeenCalled();
    // Should have created a PublicSlug
    expect(mockPublicSlugCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: 'collection',
          targetId: 'col-1',
        }),
      }),
    );
  });

  it('uses provided slug when isPublic: true and valid slug given', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
      slug: 'muj-svazek',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);
    expect(mockPublicSlugCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'muj-svazek',
          targetType: 'collection',
          targetId: 'col-1',
        }),
      }),
    );
  });

  it('returns 400 when slug is too short (invalid)', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
      slug: 'ab',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Slug musí mít alespoň/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when slug contains invalid characters', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
      slug: 'Invalid Slug!',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Slug může obsahovat pouze/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 409 when slug already taken (P2002 unique constraint)', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mockTransaction.mockRejectedValueOnce(p2002Error);

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
      slug: 'obsazeny-slug',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Tento slug je již obsazený');
  });

  it('deletes old PublicSlug before creating new one in transaction', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      isPublic: true,
      slug: 'novy-slug',
    });
    await updateCollection(req, routeContext);

    expect(mockPublicSlugDeleteMany).toHaveBeenCalledWith({ where: { targetId: 'col-1' } });
    expect(mockPublicSlugCreate).toHaveBeenCalled();
  });
});
