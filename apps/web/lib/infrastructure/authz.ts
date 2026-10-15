import { prisma } from '@/lib/infrastructure/db';

/**
 * Returns the collection only if it exists AND is owned by `userId`, otherwise null.
 *
 * Guards against cross-tenant IDOR when a page is assigned/moved to a collection:
 * verifying mere existence is not enough — without the ownership check an attacker
 * could inject their own pages into another user's (or a public) collection, which
 * is then rendered in the victim's workspace / public view and contaminates the
 * collection's LLM context (billed to the victim). Returning null lets callers
 * respond with a generic 404 that does not reveal whether the collection exists.
 */
export async function getOwnedCollection(
  userId: string,
  collectionId: string,
): Promise<{ id: string; userId: string } | null> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { id: true, userId: true },
  });
  if (!collection || collection.userId !== userId) return null;
  return collection;
}

/**
 * Čtení svazku: vlastník, veřejný svazek, nebo člen workspace, do kterého je
 * svazek zařazen (sdílené workspacy). Změny dál smí jen vlastník
 * (`getOwnedCollection` / kontrola `userId` v zápisových routách).
 */
export async function canReadCollection(
  userId: string,
  collection: { id: string; userId: string; isPublic: boolean },
): Promise<boolean> {
  if (collection.userId === userId || collection.isPublic) return true;
  const shared = await prisma.workspaceItem.findFirst({
    where: { collectionId: collection.id, workspace: { members: { some: { userId } } } },
    select: { id: true },
  });
  return shared !== null;
}

/**
 * Čtení stránky (a jejího dokumentu): vlastník, veřejná stránka, čitelný svazek,
 * nebo stránka sdílená přímo do workspace, jehož je uživatel členem.
 * Archivované („smazané") stránky vidí jen vlastník.
 */
export async function canReadPage(
  userId: string,
  page: {
    id: string;
    userId: string;
    isPublic: boolean;
    status: string;
    collectionId: string | null;
  },
): Promise<boolean> {
  if (page.userId === userId) return true;
  if (page.status === 'archived') return false;
  if (page.isPublic) return true;
  if (page.collectionId) {
    const collection = await prisma.collection.findUnique({
      where: { id: page.collectionId },
      select: { id: true, userId: true, isPublic: true },
    });
    if (collection && (await canReadCollection(userId, collection))) return true;
  }
  const shared = await prisma.workspaceItem.findFirst({
    where: { pageId: page.id, workspace: { members: { some: { userId } } } },
    select: { id: true },
  });
  return shared !== null;
}
