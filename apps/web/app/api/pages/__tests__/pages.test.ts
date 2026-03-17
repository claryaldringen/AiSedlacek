import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockPageFindMany = vi.fn();
const mockPageFindUnique = vi.fn();
const mockPageUpdate = vi.fn();
const mockPageDelete = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findMany: (...args: unknown[]) => mockPageFindMany(...args),
      findUnique: (...args: unknown[]) => mockPageFindUnique(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
      delete: (...args: unknown[]) => mockPageDelete(...args),
    },
  },
}));

const mockStorageDelete = vi.fn();
vi.mock('@/lib/adapters/storage/local-storage', () => ({
  LocalStorageProvider: class {
    delete = (...args: unknown[]) => mockStorageDelete(...args);
  },
}));

// ── Helpers ──────────────────────────────────────────────

function makeListRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/pages');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url);
}

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
  imageUrl: '/api/images/abc-123.jpg',
  order: 0,
  status: 'pending',
  collectionId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  document: {
    id: 'doc-1',
    detectedLanguage: 'de',
    translations: [{ language: 'cs' }],
  },
};

const FAKE_PAGE_DETAIL = {
  ...FAKE_PAGE,
  document: {
    id: 'doc-1',
    detectedLanguage: 'de',
    translations: [{ language: 'cs', text: 'Prelozeny text' }],
    glossary: [],
  },
};

// ── Import route handlers (after mocks) ──────────────────

import { GET as listPages } from '@/app/api/pages/route';
import {
  GET as getPage,
  PATCH as updatePage,
  DELETE as deletePage,
} from '@/app/api/pages/[id]/route';

// ── Tests ────────────────────────────────────────────────

describe('GET /api/pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns list of non-archived pages (no collectionId)', async () => {
    mockPageFindMany.mockResolvedValue([FAKE_PAGE]);

    const res = await listPages(makeListRequest());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe('page-1');

    expect(mockPageFindMany).toHaveBeenCalledWith({
      where: {
        status: { not: 'archived' },
        collectionId: null,
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: {
        document: {
          select: {
            id: true,
            detectedLanguage: true,
            translations: { select: { language: true } },
          },
        },
      },
    });
  });

  it('filters by collectionId when provided', async () => {
    mockPageFindMany.mockResolvedValue([]);

    const res = await listPages(makeListRequest({ collectionId: 'col-42' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);

    expect(mockPageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: 'archived' },
          collectionId: 'col-42',
        },
      }),
    );
  });

  it('returns empty array when no pages exist', async () => {
    mockPageFindMany.mockResolvedValue([]);

    const res = await listPages(makeListRequest());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});

describe('GET /api/pages/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns page with document details', async () => {
    mockPageFindUnique.mockResolvedValue(FAKE_PAGE_DETAIL);

    const res = await getPage(makeRequest('page-1', 'GET'), routeContext('page-1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('page-1');
    expect(json.document.id).toBe('doc-1');
    expect(json.document.translations).toHaveLength(1);
    expect(json.document.glossary).toEqual([]);

    expect(mockPageFindUnique).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      include: {
        document: {
          include: {
            translations: true,
            glossary: true,
          },
        },
      },
    });
  });

  it('returns 404 when page not found', async () => {
    mockPageFindUnique.mockResolvedValue(null);

    const res = await getPage(makeRequest('nonexistent', 'GET'), routeContext('nonexistent'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Stránka nenalezena');
  });
});

describe('PATCH /api/pages/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates collectionId', async () => {
    const updated = { ...FAKE_PAGE, collectionId: 'col-5' };
    mockPageUpdate.mockResolvedValue(updated);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { collectionId: 'col-5' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.collectionId).toBe('col-5');

    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { collectionId: 'col-5' },
    });
  });

  it('sets collectionId to null', async () => {
    const updated = { ...FAKE_PAGE, collectionId: null };
    mockPageUpdate.mockResolvedValue(updated);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { collectionId: null }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { collectionId: null },
    });
  });

  it('updates order', async () => {
    const updated = { ...FAKE_PAGE, order: 3 };
    mockPageUpdate.mockResolvedValue(updated);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { order: 3 }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order).toBe(3);

    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { order: 3 },
    });
  });

  it('updates status', async () => {
    const updated = { ...FAKE_PAGE, status: 'processed' };
    mockPageUpdate.mockResolvedValue(updated);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { status: 'processed' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('processed');

    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'processed' },
    });
  });

  it('updates multiple fields at once', async () => {
    const updated = { ...FAKE_PAGE, collectionId: 'col-2', order: 5, status: 'done' };
    mockPageUpdate.mockResolvedValue(updated);

    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { collectionId: 'col-2', order: 5, status: 'done' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(200);
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { collectionId: 'col-2', order: 5, status: 'done' },
    });
  });

  it('returns 400 when body has no valid fields', async () => {
    const res = await updatePage(
      makeRequest('page-1', 'PATCH', { unknownField: 'abc' }),
      routeContext('page-1'),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Nic k aktualizaci');
    expect(mockPageUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/pages/page-1', {
        method: 'PATCH',
        body: 'not-json{{{',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await updatePage(req, routeContext('page-1'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });

  it('returns 400 when body is not an object', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/pages/page-1', {
        method: 'PATCH',
        body: JSON.stringify('just-a-string'),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await updatePage(req, routeContext('page-1'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatné tělo požadavku');
  });

  it('returns 404 when page not found during update', async () => {
    mockPageUpdate.mockRejectedValue(new Error('Record not found'));

    const res = await updatePage(
      makeRequest('nonexistent', 'PATCH', { status: 'done' }),
      routeContext('nonexistent'),
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Stránka nenalezena');
  });
});

describe('DELETE /api/pages/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes page and its file from storage', async () => {
    mockPageFindUnique.mockResolvedValue(FAKE_PAGE);
    mockStorageDelete.mockResolvedValue(undefined);
    mockPageDelete.mockResolvedValue(FAKE_PAGE);

    const res = await deletePage(makeRequest('page-1', 'DELETE'), routeContext('page-1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify storage.delete was called with filename extracted from imageUrl
    expect(mockStorageDelete).toHaveBeenCalledWith('abc-123.jpg');

    // Verify prisma.page.delete was called
    expect(mockPageDelete).toHaveBeenCalledWith({ where: { id: 'page-1' } });
  });

  it('still deletes page when file deletion fails', async () => {
    mockPageFindUnique.mockResolvedValue(FAKE_PAGE);
    mockStorageDelete.mockRejectedValue(new Error('ENOENT'));
    mockPageDelete.mockResolvedValue(FAKE_PAGE);

    const res = await deletePage(makeRequest('page-1', 'DELETE'), routeContext('page-1'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Page should still be deleted even if file is missing
    expect(mockPageDelete).toHaveBeenCalledWith({ where: { id: 'page-1' } });
  });

  it('returns 404 when page not found', async () => {
    mockPageFindUnique.mockResolvedValue(null);

    const res = await deletePage(makeRequest('nonexistent', 'DELETE'), routeContext('nonexistent'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Stránka nenalezena');

    expect(mockPageDelete).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
  });
});
