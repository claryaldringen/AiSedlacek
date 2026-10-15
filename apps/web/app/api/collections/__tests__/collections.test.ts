import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// -- Mocks ---------------------------------------------------------------

const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockPublicSlugDeleteMany = vi.fn();
const mockPageGroupBy = vi.fn();
const mockDocumentAggregate = vi.fn();
const mockQueryRaw = vi.fn();
const mockWorkspaceItemFindFirst = vi.fn();
const mockWorkspaceFindUnique = vi.fn();
const mockWorkspaceMemberFindUnique = vi.fn();
const mockWorkspaceItemCreateMany = vi.fn();
const mockWorkspaceItemCreate = vi.fn();
const mockEnsureWorkspaces = vi.fn();

// tx object passed into $transaction callback
const txMock = {
  collection: {
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  publicSlug: {
    deleteMany: (...args: unknown[]) => mockPublicSlugDeleteMany(...args),
    create: vi.fn().mockResolvedValue({}),
  },
};

const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: typeof txMock) => unknown) => {
  return cb(txMock);
});

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    page: {
      groupBy: (...args: unknown[]) => mockPageGroupBy(...args),
    },
    document: {
      aggregate: (...args: unknown[]) => mockDocumentAggregate(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    workspace: {
      findUnique: (...args: unknown[]) => mockWorkspaceFindUnique(...args),
    },
    workspaceMember: {
      findUnique: (...args: unknown[]) => mockWorkspaceMemberFindUnique(...args),
    },
    workspaceItem: {
      createMany: (...args: unknown[]) => mockWorkspaceItemCreateMany(...args),
      create: (...args: unknown[]) => mockWorkspaceItemCreate(...args),
      findFirst: (...args: unknown[]) => mockWorkspaceItemFindFirst(...args),
    },
    publicSlug: {
      deleteMany: (...args: unknown[]) => mockPublicSlugDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// Nový svazek se po vytvoření zařadí do home workspace uživatele.
vi.mock('@/lib/infrastructure/workspace', () => ({
  ensureWorkspaces: (...args: unknown[]) => mockEnsureWorkspaces(...args),
  PUBLIC_WORKSPACE_ID: 'public-workspace',
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

// Hlavička x-locale simuluje český frontend – API podle ní volí jazyk hlášek.
const CS_LOCALE = { 'x-locale': 'cs' };

function makeRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method, headers: CS_LOCALE };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...CS_LOCALE };
  }
  return new NextRequest(new Request(url, init));
}

function makeRawRequest(url: string, method: string, rawBody: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      method,
      body: rawBody,
      headers: { 'Content-Type': 'application/json', ...CS_LOCALE },
    }),
  );
}

const routeContext = { params: Promise.resolve({ id: 'col-1' }) };

const FAKE_COLLECTION = {
  id: 'col-1',
  userId: 'test-user-id',
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

// Seznam svazků se od zavedení workspaců načítá pro konkrétní workspace –
// parametr ?workspaceId= je povinný a u ne-veřejného workspace se ověřuje členství.
describe('GET /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceFindUnique.mockResolvedValue({ type: 'home' });
    mockWorkspaceMemberFindUnique.mockResolvedValue({
      workspaceId: 'ws-1',
      userId: 'test-user-id',
      role: 'owner',
    });
    mockWorkspaceItemCreateMany.mockResolvedValue({ count: 0 });
  });

  it('returns a list of collections', async () => {
    const collections = [
      { ...FAKE_COLLECTION, _count: { pages: 3 } },
      {
        ...FAKE_COLLECTION,
        id: 'col-2',
        name: 'Druhy svazek',
        userId: 'other-user',
        _count: { pages: 0 },
      },
    ];
    // 1. volání: synchronizace vlastních svazků do home workspace, 2. volání: výpis
    mockFindMany
      .mockResolvedValueOnce([{ id: 'col-1' }, { id: 'col-2' }])
      .mockResolvedValueOnce(collections);
    // Statistiky se počítají hromadně pro všechny svazky (dřív 2 dotazy na svazek).
    mockPageGroupBy.mockResolvedValue([
      { collectionId: 'col-1', status: 'done', _count: 2 },
      { collectionId: 'col-1', status: 'pending', _count: 1 },
    ]);
    mockQueryRaw.mockResolvedValue([
      {
        collectionId: 'col-1',
        model: 'claude-opus-4-6',
        inputTokens: BigInt(600),
        outputTokens: BigInt(300),
      },
      {
        collectionId: 'col-1',
        model: 'claude-opus-5-5',
        inputTokens: BigInt(400),
        outputTokens: BigInt(200),
      },
    ]);

    const res = await listCollections(
      new NextRequest('http://localhost/api/collections?workspaceId=ws-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].name).toBe('Testovaci svazek');
    expect(json[0].stats.done).toBe(2);
    expect(json[0].stats.pending).toBe(1);
    expect(json[0].processableCount).toBe(1);
    expect(json[0].stats.inputTokens).toBe(1000);
    expect(json[0].stats.outputTokens).toBe(500);
    // Cena pro uživatele po modelech (náklad API × kurz 23 × marže 2), ne surové USD:
    // Opus 4.6: 600 × $5 + 300 × $25 = $0.0105 → 0,483 Kč = 9 660 kreditů
    // Opus 5.5: 400 × $4 + 200 × $20 = $0.0056 → 0,2576 Kč = 5 152 kreditů
    expect(json[0].stats.chargeCzk).toBe(0.7406);
    expect(json[0].stats.chargeCredits).toBe(14812);
    expect(json[0].stats).not.toHaveProperty('costUsd');
    expect(json[1].name).toBe('Druhy svazek');
    // Cizí svazek ve workspace je jen pro čtení
    expect(json[0].canEdit).toBe(true);
    expect(json[1].canEdit).toBe(false);
    expect(json[1].stats.done).toBe(0);
    expect(json[1].stats.inputTokens).toBe(0);
    expect(json[1].stats.chargeCzk).toBe(0);
    expect(json[1].stats.chargeCredits).toBe(0);
    expect(mockPageGroupBy).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    // Synchronizace do home workspace zapisuje jen svazky, které tam ještě nejsou.
    expect(mockFindMany.mock.calls[0]![0]).toEqual({
      where: { userId: 'test-user-id', workspaceItems: { none: { workspaceId: 'ws-1' } } },
      select: { id: true },
    });

    expect(mockWorkspaceMemberFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 'test-user-id' } },
    });
    expect(mockWorkspaceItemCreateMany).toHaveBeenCalledWith({
      data: [
        { workspaceId: 'ws-1', collectionId: 'col-1' },
        { workspaceId: 'ws-1', collectionId: 'col-2' },
      ],
      skipDuplicates: true,
    });
    expect(mockFindMany).toHaveBeenLastCalledWith({
      where: { workspaceItems: { some: { workspaceId: 'ws-1' } } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pages: { where: { status: { not: 'archived' } } } } } },
    });
  });

  it('returns an empty array when no collections exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await listCollections(
      new NextRequest('http://localhost/api/collections?workspaceId=ws-1'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
    expect(mockWorkspaceItemCreateMany).not.toHaveBeenCalled();
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await listCollections(new NextRequest('http://localhost/api/collections'));

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not a member of a non-public workspace', async () => {
    mockWorkspaceFindUnique.mockResolvedValue({ type: 'shared' });
    mockWorkspaceMemberFindUnique.mockResolvedValue(null);

    const res = await listCollections(
      new NextRequest('http://localhost/api/collections?workspaceId=ws-cizi'),
    );

    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureWorkspaces.mockResolvedValue({ homeId: 'ws-home', publicId: 'public-workspace' });
    mockWorkspaceItemCreate.mockResolvedValue({ id: 'wi-1' });
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
        userId: 'test-user-id',
        name: 'Testovaci svazek',
        description: 'Popis svazku',
      },
    });
    expect(mockWorkspaceItemCreate).toHaveBeenCalledWith({
      data: { workspaceId: 'ws-home', collectionId: 'col-1' },
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
        userId: 'test-user-id',
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
        userId: 'test-user-id',
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

    const req = new NextRequest('http://localhost/api/collections/col-1', { headers: CS_LOCALE });
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
          where: { status: { not: 'archived' } },
          // Shodné order (stránky z ais upload) → čas vzniku, stejně jako veřejné zobrazení
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
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

  it('lets a member of a shared workspace read a foreign collection (read-only)', async () => {
    mockFindUnique.mockResolvedValue({
      ...FAKE_COLLECTION,
      userId: 'other-user',
      isPublic: false,
      pages: [],
    });
    mockWorkspaceItemFindFirst.mockResolvedValue({ id: 'item-1' });

    const res = await getCollection(
      new NextRequest('http://localhost/api/collections/col-1', { headers: CS_LOCALE }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(false);
  });

  it("returns 404 for a foreign collection outside the user's workspaces", async () => {
    mockFindUnique.mockResolvedValue({
      ...FAKE_COLLECTION,
      userId: 'other-user',
      isPublic: false,
      pages: [],
    });
    mockWorkspaceItemFindFirst.mockResolvedValue(null);

    const res = await getCollection(
      new NextRequest('http://localhost/api/collections/col-1', { headers: CS_LOCALE }),
      routeContext,
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when collection does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/collections/nonexistent', {
      headers: CS_LOCALE,
    });
    const res = await getCollection(req, routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Svazek nenalezen');
  });
});

describe('PATCH /api/collections/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: collection found and owned by test user
    mockFindUnique.mockResolvedValue(FAKE_COLLECTION);
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
    mockFindUnique.mockResolvedValue(null);

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
    // Default: collection found and owned by test user
    mockFindUnique.mockResolvedValue(FAKE_COLLECTION);
    mockPublicSlugDeleteMany.mockResolvedValue({ count: 0 });
    mockDelete.mockResolvedValue(FAKE_COLLECTION);
    mockTransaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  it('deletes collection and returns ok', async () => {
    const req = new NextRequest('http://localhost/api/collections/col-1', {
      method: 'DELETE',
      headers: CS_LOCALE,
    });
    const res = await deleteCollection(req, routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockPublicSlugDeleteMany).toHaveBeenCalledWith({ where: { targetId: 'col-1' } });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'col-1' } });
  });

  it('returns 404 when collection does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/collections/col-1', {
      method: 'DELETE',
      headers: CS_LOCALE,
    });
    const res = await deleteCollection(req, routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Svazek nenalezen');
  });
});
