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

/**
 * Odebere člena ze sdíleného workspace (vyhození vlastníkem i odchod člena).
 *
 * V jedné transakci:
 *  - z workspace zmizí svazky a stránky, které do něj člen zařadil (patří jemu) –
 *    po odchodu je už nemůže spravovat, takže nesmí zůstat čitelné pro ostatní;
 *    samotná data se nemažou (zůstávají v jeho domovském workspace),
 *  - zruší se členství,
 *  - při `rotateInvite` se vygeneruje nový pozvánkový kód – jinak by se vyhozený
 *    člen mohl starým kódem hned vrátit.
 *
 * @returns nový pozvánkový kód (jen při `rotateInvite`)
 */
export async function removeWorkspaceMember(
  workspaceId: string,
  memberUserId: string,
  options: { rotateInvite: boolean },
): Promise<{ inviteCode: string | null; removedItems: number }> {
  return prisma.$transaction(async (tx) => {
    const { count: removedItems } = await tx.workspaceItem.deleteMany({
      where: {
        workspaceId,
        OR: [{ collection: { userId: memberUserId } }, { page: { userId: memberUserId } }],
      },
    });
    await tx.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: memberUserId } },
    });
    let inviteCode: string | null = null;
    if (options.rotateInvite) {
      inviteCode = generateInviteCode();
      await tx.workspace.update({ where: { id: workspaceId }, data: { inviteCode } });
    }
    return { inviteCode, removedItems };
  });
}

export { PUBLIC_WORKSPACE_ID };
