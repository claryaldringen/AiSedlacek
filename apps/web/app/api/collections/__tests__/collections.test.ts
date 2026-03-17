import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// -- Mocks ---------------------------------------------------------------

const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
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

function makeRawRequest(url: string, method: string, rawBody: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      method,
      body: rawBody,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const routeContext = { params: Promise.resolve({ id: 'col-1' }) };

const FAKE_COLLECTION = {
  id: 'col-1',
  name: 'Testovaci svazek',
  description: 'Popis svazku',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// -- Import route handlers (after mocks) ----------------------------------

import { GET as listCollections, POST as createCollection } from '@/app/api/collections/route';
import {
  GET as getCollection,
  PATCH as updateCollection,
  DELETE as deleteCollection,
} from '@/app/api/collections/[id]/route';

// -- Tests ----------------------------------------------------------------

describe('GET /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a list of collections', async () => {
    const collections = [
      { ...FAKE_COLLECTION, _count: { pages: 3 } },
      { ...FAKE_COLLECTION, id: 'col-2', name: 'Druhy svazek', _count: { pages: 0 } },
    ];
    mockFindMany.mockResolvedValue(collections);

    const res = await listCollections();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe('Testovaci svazek');
    expect(json[1].name).toBe('Druhy svazek');

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pages: true } } },
    });
  });

  it('returns an empty array when no collections exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await listCollections();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});

describe('POST /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a collection with name and description', async () => {
    mockCreate.mockResolvedValue({ ...FAKE_COLLECTION });

    const req = makeRequest('http://localhost/api/collections', 'POST', {
      name: 'Testovaci svazek',
      description: 'Popis svazku',
    });
    const res = await createCollection(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe('Testovaci svazek');

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'Testovaci svazek',
        description: 'Popis svazku',
      },
    });
  });

  it('creates a collection with name only (description defaults to empty string)', async () => {
    mockCreate.mockResolvedValue({ ...FAKE_COLLECTION, description: '' });

    const req = makeRequest('http://localhost/api/collections', 'POST', {
      name: 'Jen nazev',
    });
    const res = await createCollection(req);

    expect(res.status).toBe(201);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'Jen nazev',
        description: '',
      },
    });
  });

  it('trims whitespace from name and description', async () => {
    mockCreate.mockResolvedValue({ ...FAKE_COLLECTION });

    const req = makeRequest('http://localhost/api/collections', 'POST', {
      name: '  Trimmed name  ',
      description: '  Trimmed desc  ',
    });
    await createCollection(req);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'Trimmed name',
        description: 'Trimmed desc',
      },
    });
  });

  it('returns 400 when name is missing', async () => {
    const req = makeRequest('http://localhost/api/collections', 'POST', {
      description: 'Bez nazvu',
    });
    const res = await createCollection(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Název svazku je povinný');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string', async () => {
    const req = makeRequest('http://localhost/api/collections', 'POST', {
      name: '   ',
    });
    const res = await createCollection(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Název svazku je povinný');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = makeRawRequest('http://localhost/api/collections', 'POST', 'not json{{{');
    const res = await createCollection(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });
});

describe('GET /api/collections/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns collection with pages', async () => {
    const collectionWithPages = {
      ...FAKE_COLLECTION,
      pages: [
        {
          id: 'page-1',
          order: 1,
          document: { id: 'doc-1', detectedLanguage: 'cs', translations: [{ language: 'cs' }] },
        },
      ],
    };
    mockFindUnique.mockResolvedValue(collectionWithPages);

    const req = new NextRequest('http://localhost/api/collections/col-1');
    const res = await getCollection(req, routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('col-1');
    expect(json.pages).toHaveLength(1);
    expect(json.pages[0].document.id).toBe('doc-1');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'col-1' },
      include: {
        pages: {
          orderBy: { order: 'asc' },
          include: {
            document: {
              select: {
                id: true,
                detectedLanguage: true,
                translations: { select: { language: true } },
              },
            },
          },
        },
      },
    });
  });

  it('returns 404 when collection does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/collections/nonexistent');
    const res = await getCollection(req, routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Svazek nenalezen');
  });
});

describe('PATCH /api/collections/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates collection name', async () => {
    mockUpdate.mockResolvedValue({ ...FAKE_COLLECTION, name: 'Novy nazev' });

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      name: 'Novy nazev',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('Novy nazev');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'col-1' },
      data: { name: 'Novy nazev' },
    });
  });

  it('updates collection description', async () => {
    mockUpdate.mockResolvedValue({ ...FAKE_COLLECTION, description: 'Novy popis' });

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      description: 'Novy popis',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'col-1' },
      data: { description: 'Novy popis' },
    });
  });

  it('updates both name and description', async () => {
    mockUpdate.mockResolvedValue({
      ...FAKE_COLLECTION,
      name: 'Novy nazev',
      description: 'Novy popis',
    });

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      name: 'Novy nazev',
      description: 'Novy popis',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'col-1' },
      data: { name: 'Novy nazev', description: 'Novy popis' },
    });
  });

  it('returns 400 when no valid fields provided', async () => {
    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {});
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Nic k aktualizaci');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = makeRawRequest('http://localhost/api/collections/col-1', 'PATCH', 'not json{{{');
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });

  it('returns 404 when collection does not exist', async () => {
    mockUpdate.mockRejectedValue(new Error('Record not found'));

    const req = makeRequest('http://localhost/api/collections/col-1', 'PATCH', {
      name: 'Novy nazev',
    });
    const res = await updateCollection(req, routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Svazek nenalezen');
  });
});

describe('DELETE /api/collections/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes collection and returns ok', async () => {
    mockDelete.mockResolvedValue(FAKE_COLLECTION);

    const req = new NextRequest('http://localhost/api/collections/col-1', {
      method: 'DELETE',
    });
    const res = await deleteCollection(req, routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'col-1' } });
  });

  it('returns 404 when collection does not exist', async () => {
    mockDelete.mockRejectedValue(new Error('Record not found'));

    const req = new NextRequest('http://localhost/api/collections/col-1', {
      method: 'DELETE',
    });
    const res = await deleteCollection(req, routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Svazek nenalezen');
  });
});
