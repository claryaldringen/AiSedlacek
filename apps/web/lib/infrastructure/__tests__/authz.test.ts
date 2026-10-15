import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sdílené workspacy (ARCH-1): číst smí vlastník, kdokoli u veřejného obsahu
// a členové workspace, do kterého je svazek/stránka zařazena.

const mockWorkspaceItemFindFirst = vi.fn();
const mockCollectionFindUnique = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    workspaceItem: { findFirst: (...args: unknown[]) => mockWorkspaceItemFindFirst(...args) },
    collection: { findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args) },
  },
}));

import { canReadCollection, canReadPage } from '../authz';

const collection = { id: 'col-1', userId: 'owner', isPublic: false };
const page = {
  id: 'page-1',
  userId: 'owner',
  isPublic: false,
  status: 'done',
  collectionId: 'col-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceItemFindFirst.mockResolvedValue(null);
  mockCollectionFindUnique.mockResolvedValue(collection);
});

describe('canReadCollection', () => {
  it('owner and anyone for a public collection', async () => {
    expect(await canReadCollection('owner', collection)).toBe(true);
    expect(await canReadCollection('stranger', { ...collection, isPublic: true })).toBe(true);
    expect(mockWorkspaceItemFindFirst).not.toHaveBeenCalled();
  });

  it('member of a workspace containing the collection', async () => {
    mockWorkspaceItemFindFirst.mockResolvedValue({ id: 'item-1' });

    expect(await canReadCollection('member', collection)).toBe(true);
    expect(mockWorkspaceItemFindFirst).toHaveBeenCalledWith({
      where: { collectionId: 'col-1', workspace: { members: { some: { userId: 'member' } } } },
      select: { id: true },
    });
  });

  it('nobody else', async () => {
    expect(await canReadCollection('stranger', collection)).toBe(false);
  });
});

describe('canReadPage', () => {
  it('member reads a page through its shared collection', async () => {
    mockWorkspaceItemFindFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve('collectionId' in args.where ? { id: 'item-1' } : null),
    );

    expect(await canReadPage('member', page)).toBe(true);
  });

  it('member reads a page shared directly into the workspace', async () => {
    mockWorkspaceItemFindFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve('pageId' in args.where ? { id: 'item-2' } : null),
    );

    expect(await canReadPage('member', { ...page, collectionId: null })).toBe(true);
  });

  it('archived pages stay private to the owner', async () => {
    mockWorkspaceItemFindFirst.mockResolvedValue({ id: 'item-1' });

    expect(await canReadPage('member', { ...page, status: 'archived', isPublic: true })).toBe(
      false,
    );
    expect(await canReadPage('owner', { ...page, status: 'archived' })).toBe(true);
  });

  it('strangers cannot read a private page', async () => {
    expect(await canReadPage('stranger', page)).toBe(false);
  });
});

// Historie verzí: veřejnost nestačí, jen vlastník a členové sdíleného workspace.
describe('canReadPage with allowPublic: false', () => {
  const noPublic = { allowPublic: false };

  it('owner still reads', async () => {
    expect(await canReadPage('owner', { ...page, isPublic: true }, noPublic)).toBe(true);
  });

  it('a public page or a page in a public collection is not enough', async () => {
    mockCollectionFindUnique.mockResolvedValue({ ...collection, isPublic: true });

    expect(await canReadPage('stranger', { ...page, isPublic: true }, noPublic)).toBe(false);
  });

  it('membership counts only in shared workspaces (not the public one)', async () => {
    mockWorkspaceItemFindFirst.mockResolvedValue({ id: 'item-1' });

    expect(await canReadPage('member', page, noPublic)).toBe(true);
    expect(mockWorkspaceItemFindFirst).toHaveBeenCalledWith({
      where: {
        collectionId: 'col-1',
        workspace: { members: { some: { userId: 'member' } }, type: 'shared' },
      },
      select: { id: true },
    });
  });

  it('page shared directly into a shared workspace', async () => {
    mockWorkspaceItemFindFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve('pageId' in args.where ? { id: 'item-2' } : null),
    );

    expect(await canReadPage('member', { ...page, collectionId: null }, noPublic)).toBe(true);
    expect(mockWorkspaceItemFindFirst).toHaveBeenCalledWith({
      where: {
        pageId: 'page-1',
        workspace: { members: { some: { userId: 'member' } }, type: 'shared' },
      },
      select: { id: true },
    });
  });
});
