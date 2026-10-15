import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Čtecí pravidla na úrovni rout (sdílené workspacy, ARCH-1): GET stránky,
// dokumentu, historie verzí a workspace se skutečným `canReadPage` (authz.ts)
// nad malým modelem dat – vlastník, člen sdíleného workspace, cizí uživatel.

// ── Data ─────────────────────────────────────────────────

type Fixture = {
  id: string;
  userId: string;
  isPublic: boolean;
  status: string;
  collectionId: string | null;
};

const COLLECTIONS = {
  'col-shared': { id: 'col-shared', userId: 'owner', isPublic: false },
  'col-public': { id: 'col-public', userId: 'owner', isPublic: true },
  'col-private': { id: 'col-private', userId: 'owner', isPublic: false },
} as const;

const PAGES: Record<string, Fixture> = {
  'page-shared': {
    id: 'page-shared',
    userId: 'owner',
    isPublic: false,
    status: 'done',
    collectionId: 'col-shared',
  },
  'page-private': {
    id: 'page-private',
    userId: 'owner',
    isPublic: false,
    status: 'done',
    collectionId: 'col-private',
  },
  'page-archived': {
    id: 'page-archived',
    userId: 'owner',
    isPublic: false,
    status: 'archived',
    collectionId: 'col-shared',
  },
  'page-public': {
    id: 'page-public',
    userId: 'owner',
    isPublic: true,
    status: 'done',
    collectionId: 'col-private',
  },
  'page-in-public-col': {
    id: 'page-in-public-col',
    userId: 'owner',
    isPublic: false,
    status: 'done',
    collectionId: 'col-public',
  },
};

// Členství a zařazení položek. Veřejný workspace v praxi členy nemá – „člen"
// je tu schválně, aby se ověřilo, že historii verzí neotevře.
const WORKSPACES = [
  {
    id: 'ws-shared',
    type: 'shared',
    members: ['owner', 'member'],
    items: [{ collectionId: 'col-shared' }],
  },
  {
    id: 'public-workspace',
    type: 'public',
    members: ['public-member'],
    items: [{ collectionId: 'col-public' }],
  },
];

type ItemWhere = {
  collectionId?: string;
  pageId?: string;
  workspace: { members: { some: { userId: string } }; type?: string };
};

function findWorkspaceItem({ where }: { where: ItemWhere }): { id: string } | null {
  const userId = where.workspace.members.some.userId;
  const hit = WORKSPACES.some(
    (ws) =>
      ws.members.includes(userId) &&
      (where.workspace.type === undefined || ws.type === where.workspace.type) &&
      ws.items.some(
        (item) =>
          (where.collectionId !== undefined && item.collectionId === where.collectionId) ||
          (where.pageId !== undefined && 'pageId' in item && item.pageId === where.pageId),
      ),
  );
  return hit ? { id: 'item' } : null;
}

function documentFor(pageId: string): Record<string, unknown> {
  return { id: `doc-${pageId}`, pageId, translations: [], glossary: [] };
}

// ── Mocks ────────────────────────────────────────────────

let currentUser = 'owner';
const mockVersionFindMany = vi.fn();
const mockWorkspaceFindUnique = vi.fn();
const mockWorkspaceFindMany = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const page = PAGES[where.id];
        return page ? { ...page, document: documentFor(page.id) } : null;
      },
    },
    document: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const page = PAGES[where.id.replace(/^doc-/, '')];
        return page ? { ...documentFor(page.id), page } : null;
      },
    },
    documentVersion: { findMany: (...args: unknown[]) => mockVersionFindMany(...args) },
    collection: {
      findUnique: async ({ where }: { where: { id: keyof typeof COLLECTIONS } }) =>
        COLLECTIONS[where.id] ?? null,
    },
    workspaceItem: { findFirst: async (args: { where: ItemWhere }) => findWorkspaceItem(args) },
    workspace: {
      findUnique: (...args: unknown[]) => mockWorkspaceFindUnique(...args),
      findMany: (...args: unknown[]) => mockWorkspaceFindMany(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn(async () => currentUser),
}));

vi.mock('@/lib/adapters/storage', () => ({
  getStorage: vi.fn(),
  storageKeyFromImageUrl: vi.fn(),
}));

vi.mock('@/lib/infrastructure/workspace', () => ({
  PUBLIC_WORKSPACE_ID: 'public-workspace',
  ensureWorkspaces: vi.fn(async () => ({ homeId: 'ws-home', publicId: 'public-workspace' })),
  generateInviteCode: vi.fn(),
}));

import { GET as getPage } from '@/app/api/pages/[id]/route';
import { GET as getDocument } from '@/app/api/documents/[id]/route';
import { GET as getVersions } from '@/app/api/documents/[id]/versions/route';
import { GET as getWorkspace } from '@/app/api/workspaces/[id]/route';
import { GET as listWorkspaces } from '@/app/api/workspaces/route';

// ── Helpers ──────────────────────────────────────────────

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function readPage(user: string, pageId: string): Promise<Response> {
  currentUser = user;
  return getPage(get(`/api/pages/${pageId}`), ctx(pageId));
}

async function readDocument(user: string, pageId: string): Promise<Response> {
  currentUser = user;
  return getDocument(get(`/api/documents/doc-${pageId}`), ctx(`doc-${pageId}`));
}

async function readVersions(user: string, pageId: string): Promise<Response> {
  currentUser = user;
  return getVersions(get(`/api/documents/doc-${pageId}/versions`), ctx(`doc-${pageId}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVersionFindMany.mockResolvedValue([{ id: 'v-1', version: 1, content: 'stará verze' }]);
});

// ── GET /api/pages/[id] a /api/documents/[id] ───────────

describe.each([
  ['GET /api/pages/[id]', readPage],
  ['GET /api/documents/[id]', readDocument],
] as const)('%s – read access', (_name, read) => {
  it('owner reads and may edit', async () => {
    const res = await read('owner', 'page-shared');
    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(true);
  });

  it('member of a shared workspace reads read-only', async () => {
    const res = await read('member', 'page-shared');
    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(false);
  });

  it('stranger gets 404 for a private page', async () => {
    expect((await read('stranger', 'page-private')).status).toBe(404);
  });

  it('archived page is 404 even for a member of the shared workspace', async () => {
    expect((await read('member', 'page-archived')).status).toBe(404);
    expect((await read('owner', 'page-archived')).status).toBe(200);
  });

  it('anyone reads a public page or a page in a public collection, read-only', async () => {
    const res = await read('stranger', 'page-public');
    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(false);
    expect((await read('stranger', 'page-in-public-col')).status).toBe(200);
  });
});

// ── GET /api/documents/[id]/versions ────────────────────

describe('GET /api/documents/[id]/versions – read access', () => {
  it('owner and shared-workspace member read the history', async () => {
    expect((await readVersions('owner', 'page-shared')).status).toBe(200);
    const res = await readVersions('member', 'page-shared');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'v-1', version: 1, content: 'stará verze' }]);
  });

  it('stranger gets 404 for a private document', async () => {
    expect((await readVersions('stranger', 'page-private')).status).toBe(404);
    expect(mockVersionFindMany).not.toHaveBeenCalled();
  });

  it('archived page history stays private to the owner', async () => {
    expect((await readVersions('member', 'page-archived')).status).toBe(404);
  });

  it('public page or public collection does not expose the history', async () => {
    // Historie může obsahovat text, který vlastník před zveřejněním smazal.
    expect((await readVersions('stranger', 'page-public')).status).toBe(404);
    expect((await readVersions('stranger', 'page-in-public-col')).status).toBe(404);
    expect((await readVersions('public-member', 'page-in-public-col')).status).toBe(404);
    expect(mockVersionFindMany).not.toHaveBeenCalled();
  });
});

// ── GET /api/workspaces/[id] ─────────────────────────────

function collection(id: string, isPublic: boolean): Record<string, unknown> {
  return { id, userId: 'owner', isPublic, name: id, _count: { pages: 1 } };
}

function orphanPage(id: string, isPublic: boolean, status = 'done'): Record<string, unknown> {
  return { id, userId: 'owner', isPublic, status, document: null };
}

describe('GET /api/workspaces/[id] – filtering', () => {
  it('public workspace lists only items that are still public and not archived', async () => {
    currentUser = 'stranger';
    mockWorkspaceFindUnique.mockResolvedValue({
      id: 'public-workspace',
      type: 'public',
      ownerId: null,
      inviteCode: null,
      members: [],
      owner: null,
      items: [
        { collection: collection('col-public', true), page: null },
        { collection: collection('col-unpublished', false), page: null },
        { collection: null, page: orphanPage('page-public', true) },
        { collection: null, page: orphanPage('page-unpublished', false) },
        { collection: null, page: orphanPage('page-archived', true, 'archived') },
      ],
    });

    const res = await getWorkspace(
      get('/api/workspaces/public-workspace'),
      ctx('public-workspace'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.collections.map((c: { id: string }) => c.id)).toEqual(['col-public']);
    expect(json.orphanPages.map((p: { id: string }) => p.id)).toEqual(['page-public']);
    // Syrové položky (vč. odfiltrovaných) se nevrací.
    expect(json).not.toHaveProperty('items');
  });

  const sharedWorkspace = {
    id: 'ws-shared',
    type: 'shared',
    ownerId: 'owner',
    inviteCode: 'secret-invite',
    members: [
      { userId: 'owner', role: 'owner', user: { id: 'owner' } },
      { userId: 'member', role: 'member', user: { id: 'member' } },
    ],
    owner: { id: 'owner' },
    items: [
      { collection: collection('col-shared', false), page: null },
      { collection: null, page: orphanPage('page-direct', false) },
      { collection: null, page: orphanPage('page-archived', false, 'archived') },
    ],
  };

  it('shared workspace hides archived pages and the invite code from members', async () => {
    currentUser = 'member';
    mockWorkspaceFindUnique.mockResolvedValue(sharedWorkspace);

    const res = await getWorkspace(get('/api/workspaces/ws-shared'), ctx('ws-shared'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.collections.map((c: { id: string }) => c.id)).toEqual(['col-shared']);
    expect(json.orphanPages.map((p: { id: string }) => p.id)).toEqual(['page-direct']);
    expect(json).not.toHaveProperty('items');
    expect(json.inviteCode).toBeNull();
  });

  it('owner of the shared workspace gets the invite code', async () => {
    currentUser = 'owner';
    mockWorkspaceFindUnique.mockResolvedValue(sharedWorkspace);

    const json = await (
      await getWorkspace(get('/api/workspaces/ws-shared'), ctx('ws-shared'))
    ).json();

    expect(json.inviteCode).toBe('secret-invite');
  });

  it('non-member gets 404 for a shared workspace', async () => {
    currentUser = 'stranger';
    mockWorkspaceFindUnique.mockResolvedValue(sharedWorkspace);

    const res = await getWorkspace(get('/api/workspaces/ws-shared'), ctx('ws-shared'));

    expect(res.status).toBe(404);
  });
});

// ── GET /api/workspaces ─────────────────────────────────

describe('GET /api/workspaces – invite code', () => {
  it('returns the invite code only for workspaces the user owns', async () => {
    currentUser = 'member';
    mockWorkspaceFindMany.mockResolvedValue([
      { id: 'ws-home', type: 'home', ownerId: 'member', inviteCode: null },
      { id: 'ws-mine', type: 'shared', ownerId: 'member', inviteCode: 'my-code' },
      { id: 'ws-shared', type: 'shared', ownerId: 'owner', inviteCode: 'secret-invite' },
    ]);

    const res = await listWorkspaces(get('/api/workspaces'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; inviteCode: string | null }[];
    expect(Object.fromEntries(json.map((w) => [w.id, w.inviteCode]))).toEqual({
      'ws-home': null,
      'ws-mine': 'my-code',
      'ws-shared': null,
    });
  });
});
