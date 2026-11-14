import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Sdílený workspace: odebrání člena vlastníkem, opuštění členem a rotace
// pozvánkového kódu – nad malým in-memory modelem.

interface Member {
  workspaceId: string;
  userId: string;
}
interface Item {
  workspaceId: string;
  collectionId?: string;
  pageId?: string;
}

const db = vi.hoisted(() => ({
  workspaces: [] as {
    id: string;
    type: string;
    ownerId: string | null;
    inviteCode: string | null;
  }[],
  members: [] as Member[],
  items: [] as Item[],
  collections: {} as Record<string, { userId: string }>,
  pages: {} as Record<string, { userId: string }>,
  currentUser: 'owner',
}));

const prismaMock = vi.hoisted(() => {
  const ownerOf = (item: Item): string | undefined =>
    item.collectionId
      ? db.collections[item.collectionId]?.userId
      : item.pageId
        ? db.pages[item.pageId]?.userId
        : undefined;
  const client = {
    workspace: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const ws = db.workspaces.find((w) => w.id === where.id);
        if (!ws) return null;
        return {
          ...ws,
          members: db.members
            .filter((m) => m.workspaceId === ws.id)
            .map((m) => ({
              userId: m.userId,
            })),
        };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { inviteCode: string } }) => {
          const ws = db.workspaces.find((w) => w.id === where.id)!;
          Object.assign(ws, data);
          return ws;
        },
      ),
    },
    workspaceItem: {
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId: string;
            OR: [{ collection: { userId: string } }, { page: { userId: string } }];
          };
        }) => {
          const userId = where.OR[0].collection.userId;
          const before = db.items.length;
          db.items = db.items.filter(
            (i) => !(i.workspaceId === where.workspaceId && ownerOf(i) === userId),
          );
          return { count: before - db.items.length };
        },
      ),
    },
    workspaceMember: {
      delete: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_userId: { workspaceId: string; userId: string } };
        }) => {
          const { workspaceId, userId } = where.workspaceId_userId;
          db.members = db.members.filter(
            (m) => !(m.workspaceId === workspaceId && m.userId === userId),
          );
          return {};
        },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(client)),
  };
  return client;
});

vi.mock('@/lib/infrastructure/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn(async () => ({ userId: db.currentUser })),
}));

import { DELETE as removeMember } from '@/app/api/workspaces/[id]/members/[userId]/route';
import { POST as rotateInvite } from '@/app/api/workspaces/[id]/invite-code/route';

function req(url: string, method: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method, headers: { 'x-locale': 'cs' } });
}

function memberCtx(
  id: string,
  userId: string,
): { params: Promise<{ id: string; userId: string }> } {
  return { params: Promise.resolve({ id, userId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.currentUser = 'owner';
  db.workspaces = [
    { id: 'ws', type: 'shared', ownerId: 'owner', inviteCode: 'old-code' },
    { id: 'home', type: 'home', ownerId: 'owner', inviteCode: null },
  ];
  db.members = [
    { workspaceId: 'ws', userId: 'owner' },
    { workspaceId: 'ws', userId: 'alice' },
    { workspaceId: 'ws', userId: 'bob' },
    { workspaceId: 'home', userId: 'owner' },
  ];
  db.collections = {
    'col-owner': { userId: 'owner' },
    'col-alice': { userId: 'alice' },
    'col-bob': { userId: 'bob' },
  };
  db.pages = { 'page-alice': { userId: 'alice' } };
  db.items = [
    { workspaceId: 'ws', collectionId: 'col-owner' },
    { workspaceId: 'ws', collectionId: 'col-alice' },
    { workspaceId: 'ws', pageId: 'page-alice' },
    { workspaceId: 'ws', collectionId: 'col-bob' },
  ];
});

describe('DELETE /api/workspaces/[id]/members/[userId]', () => {
  it('vlastník odebere člena: zmizí jeho položky a pozvánkový kód se změní', async () => {
    const res = await removeMember(
      req('/api/workspaces/ws/members/alice', 'DELETE'),
      memberCtx('ws', 'alice'),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { inviteCode: string; removedItems: number };
    expect(db.members.map((m) => m.userId)).not.toContain('alice');
    // Alicin svazek i stránka z workspace zmizely, cizí položky zůstaly
    expect(db.items).toEqual([
      { workspaceId: 'ws', collectionId: 'col-owner' },
      { workspaceId: 'ws', collectionId: 'col-bob' },
    ]);
    expect(body.removedItems).toBe(2);
    // Starým kódem se odebraný člen už nevrátí
    expect(db.workspaces[0]!.inviteCode).not.toBe('old-code');
    expect(body.inviteCode).toBe(db.workspaces[0]!.inviteCode);
    // Vše v jedné transakci
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('člen opustí workspace: zmizí jen jeho položky, kód zůstává', async () => {
    db.currentUser = 'bob';

    const res = await removeMember(
      req('/api/workspaces/ws/members/bob', 'DELETE'),
      memberCtx('ws', 'bob'),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, inviteCode: null, removedItems: 1 });
    expect(db.members.map((m) => m.userId)).toEqual(['owner', 'alice', 'owner']);
    expect(db.items.map((i) => i.collectionId ?? i.pageId)).toEqual([
      'col-owner',
      'col-alice',
      'page-alice',
    ]);
    expect(db.workspaces[0]!.inviteCode).toBe('old-code');
  });

  it('člen nesmí odebrat jiného člena', async () => {
    db.currentUser = 'bob';

    const res = await removeMember(
      req('/api/workspaces/ws/members/alice', 'DELETE'),
      memberCtx('ws', 'alice'),
    );

    expect(res.status).toBe(403);
    expect(db.members).toHaveLength(4);
    expect(db.items).toHaveLength(4);
  });

  it('vlastník workspace neopustí (zůstal by bez vlastníka)', async () => {
    const res = await removeMember(
      req('/api/workspaces/ws/members/owner', 'DELETE'),
      memberCtx('ws', 'owner'),
    );

    expect(res.status).toBe(400);
    expect(db.members).toHaveLength(4);
  });

  it('kdo není členem, dostane 404 – i když zná ID workspace', async () => {
    db.currentUser = 'stranger';

    const res = await removeMember(
      req('/api/workspaces/ws/members/alice', 'DELETE'),
      memberCtx('ws', 'alice'),
    );

    expect(res.status).toBe(404);
    expect(db.members).toHaveLength(4);
  });

  it('domovský workspace nemá členy k odebrání (404)', async () => {
    const res = await removeMember(
      req('/api/workspaces/home/members/owner', 'DELETE'),
      memberCtx('home', 'owner'),
    );

    expect(res.status).toBe(404);
  });

  it('nečlen jako cíl → 404', async () => {
    const res = await removeMember(
      req('/api/workspaces/ws/members/nobody', 'DELETE'),
      memberCtx('ws', 'nobody'),
    );

    expect(res.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspaces/[id]/invite-code', () => {
  const ctx = { params: Promise.resolve({ id: 'ws' }) };

  it('vlastník vygeneruje nový kód, starý přestane platit', async () => {
    const res = await rotateInvite(req('/api/workspaces/ws/invite-code', 'POST'), ctx);

    expect(res.status).toBe(200);
    const { inviteCode } = (await res.json()) as { inviteCode: string };
    expect(inviteCode).toMatch(/^[0-9a-f]{16}$/);
    expect(inviteCode).not.toBe('old-code');
    expect(db.workspaces[0]!.inviteCode).toBe(inviteCode);
  });

  it('člen kód měnit nesmí', async () => {
    db.currentUser = 'alice';

    const res = await rotateInvite(req('/api/workspaces/ws/invite-code', 'POST'), ctx);

    expect(res.status).toBe(403);
    expect(db.workspaces[0]!.inviteCode).toBe('old-code');
  });

  it('cizí uživatel dostane 404', async () => {
    db.currentUser = 'stranger';

    const res = await rotateInvite(req('/api/workspaces/ws/invite-code', 'POST'), ctx);

    expect(res.status).toBe(404);
  });
});
