import { prisma } from './db';
import crypto from 'crypto';

const PUBLIC_WORKSPACE_ID = 'public-workspace';

/**
 * Ensure user has a home workspace. Creates one if missing.
 * Also ensures the global public workspace exists.
 */
export async function ensureWorkspaces(
  userId: string,
): Promise<{ homeId: string; publicId: string }> {
  // Ensure public workspace exists and contains all public collections
  await prisma.workspace.upsert({
    where: { id: PUBLIC_WORKSPACE_ID },
    create: { id: PUBLIC_WORKSPACE_ID, name: 'Veřejné dokumenty', type: 'public' },
    update: {},
  });

  // Sync: add any public collections missing from the workspace
  const publicCollections = await prisma.collection.findMany({
    where: { isPublic: true },
    select: { id: true },
  });
  if (publicCollections.length > 0) {
    await prisma.workspaceItem.createMany({
      data: publicCollections.map((c) => ({
        workspaceId: PUBLIC_WORKSPACE_ID,
        collectionId: c.id,
      })),
      skipDuplicates: true,
    });
  }

  // Ensure user has home workspace
  let home = await prisma.workspace.findFirst({
    where: { ownerId: userId, type: 'home' },
  });
  if (!home) {
    home = await prisma.workspace.create({
      data: {
        name: 'Můj workspace',
        type: 'home',
        ownerId: userId,
        members: { create: { userId, role: 'owner' } },
      },
    });
  }

  // Always sync: ensure all user's collections are in home workspace
  const collections = await prisma.collection.findMany({
    where: { userId },
    select: { id: true },
  });
  if (collections.length > 0) {
    await prisma.workspaceItem.createMany({
      data: collections.map((c) => ({ workspaceId: home.id, collectionId: c.id })),
      skipDuplicates: true,
    });
  }

  return { homeId: home.id, publicId: PUBLIC_WORKSPACE_ID };
}

export function generateInviteCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export { PUBLIC_WORKSPACE_ID };
