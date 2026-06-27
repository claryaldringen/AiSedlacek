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
