import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { computeCostFromTokens } from '@/lib/pricing';
import { ensureWorkspaces } from '@/lib/infrastructure/workspace';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const workspaceId = request.nextUrl.searchParams.get('workspaceId');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let collections: any[];
  if (workspaceId) {
    // Check if user is a member of this workspace
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true, ownerId: true },
    });

    // Sync user's collections to their home workspace
    if (ws?.type === 'home') {
      const userCollections = await prisma.collection.findMany({
        where: { userId },
        select: { id: true },
      });
      if (userCollections.length > 0) {
        await prisma.workspaceItem.createMany({
          data: userCollections.map((c) => ({ workspaceId, collectionId: c.id })),
          skipDuplicates: true,
        });
      }
    }

    // Filter collections by workspace membership
    const items = await prisma.workspaceItem.findMany({
      where: { workspaceId, collectionId: { not: null } },
      select: { collectionId: true },
    });
    const collectionIds = items.map((i) => i.collectionId!);

    if (collectionIds.length > 0) {
      collections = await prisma.collection.findMany({
        where: { id: { in: collectionIds } },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { pages: true } },
        },
      });
    } else if (ws?.type === 'home' || (member && ws?.type !== 'public')) {
      // Fallback: if workspace has no collection items, return user's collections directly
      collections = await prisma.collection.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { pages: true } },
        },
      });
    } else {
      collections = [];
    }
  } else {
    collections = await prisma.collection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { pages: true } },
      },
    });
  }

  // Add stats for each collection
  const collectionsWithStats = await Promise.all(
    collections.map(async (c) => {
      const [statusCounts, tokenAgg] = await Promise.all([
        prisma.page.groupBy({
          by: ['status'],
          where: { collectionId: c.id },
          _count: true,
        }),
        prisma.document.aggregate({
          where: { page: { collectionId: c.id } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
      ]);

      const byStatus: Record<string, number> = {};
      for (const s of statusCounts) {
        byStatus[s.status] = s._count;
      }

      const inputTokens = tokenAgg._sum.inputTokens ?? 0;
      const outputTokens = tokenAgg._sum.outputTokens ?? 0;
      const costUsd = computeCostFromTokens(inputTokens, outputTokens);

      return {
        ...c,
        processableCount: (byStatus['pending'] ?? 0) + (byStatus['error'] ?? 0),
        stats: {
          done: byStatus['done'] ?? 0,
          pending: byStatus['pending'] ?? 0,
          error: byStatus['error'] ?? 0,
          processing: byStatus['processing'] ?? 0,
          blank: byStatus['blank'] ?? 0,
          inputTokens,
          outputTokens,
          costUsd: Math.round(costUsd * 100) / 100,
        },
      };
    }),
  );

  return NextResponse.json(collectionsWithStats);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { getApiTranslations } = await import('@/lib/infrastructure/api-locale');
  const t = await getApiTranslations(request, 'api');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const { name, description, workspaceId } = body as {
    name?: unknown;
    description?: unknown;
    workspaceId?: unknown;
  };

  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: t('collectionNameRequired') }, { status: 400 });
  }

  const collection = await prisma.collection.create({
    data: {
      userId,
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
    },
  });

  // Add collection to workspace (specified or user's home workspace)
  try {
    let targetWorkspaceId: string;
    if (typeof workspaceId === 'string' && workspaceId.trim() !== '') {
      // Verify user has access to the target workspace
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: workspaceId.trim(), userId } },
      });
      if (!member) {
        // Fallback to home workspace if user is not a member
        const { homeId } = await ensureWorkspaces(userId);
        targetWorkspaceId = homeId;
      } else {
        targetWorkspaceId = workspaceId.trim();
      }
    } else {
      const { homeId } = await ensureWorkspaces(userId);
      targetWorkspaceId = homeId;
    }

    await prisma.workspaceItem.create({
      data: { workspaceId: targetWorkspaceId, collectionId: collection.id },
    });
  } catch (err) {
    // Non-critical: log but don't fail collection creation
    console.error('[collections/POST] Failed to add WorkspaceItem:', err);
  }

  return NextResponse.json(collection, { status: 201 });
}
