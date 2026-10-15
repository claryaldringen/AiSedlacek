import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/infrastructure/db';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { usageCostUsd } from '@ai-sedlacek/shared';
import { ensureWorkspaces } from '@/lib/infrastructure/workspace';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  }

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { type: true },
  });
  if (!ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  // Authorization: public workspaces are accessible to any signed-in user;
  // home/shared workspaces require membership.
  if (ws.type !== 'public') {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Sync user's collections to workspace items (home workspace only). Zapisuje
  // se jen chybějící – listing se volá po většině akcí v UI a dřív každé čtení
  // dělalo createMany přes všechny svazky uživatele.
  if (ws.type === 'home') {
    const missing = await prisma.collection.findMany({
      where: { userId, workspaceItems: { none: { workspaceId } } },
      select: { id: true },
    });
    if (missing.length > 0) {
      await prisma.workspaceItem.createMany({
        data: missing.map((c) => ({ workspaceId, collectionId: c.id })),
        skipDuplicates: true,
      });
    }
  }

  const collections = await prisma.collection.findMany({
    where: {
      workspaceItems: { some: { workspaceId } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      // Archivované („smazané") stránky se nepočítají.
      _count: { select: { pages: { where: { status: { not: 'archived' } } } } },
    },
  });

  // Statistiky všech svazků dvěma dotazy místo dvou dotazů na každý svazek (N+1).
  const collectionIds = collections.map((c) => c.id);
  const [statusCounts, tokenSums] = collectionIds.length
    ? await Promise.all([
        prisma.page.groupBy({
          by: ['collectionId', 'status'],
          where: { collectionId: { in: collectionIds } },
          _count: true,
        }),
        // Po modelech – náklad se počítá sazbou modelu, který dokument zpracoval.
        prisma.$queryRaw<
          {
            collectionId: string;
            model: string | null;
            inputTokens: bigint | null;
            outputTokens: bigint | null;
          }[]
        >(Prisma.sql`
          SELECT p."collectionId" AS "collectionId",
                 d."model" AS "model",
                 SUM(d."inputTokens") AS "inputTokens",
                 SUM(d."outputTokens") AS "outputTokens"
          FROM "Document" d
          JOIN "Page" p ON p."id" = d."pageId"
          WHERE p."collectionId" IN (${Prisma.join(collectionIds)})
          GROUP BY p."collectionId", d."model"
        `),
      ])
    : [[], []];

  const statusByCollection = new Map<string, Record<string, number>>();
  for (const s of statusCounts) {
    if (!s.collectionId) continue;
    const byStatus = statusByCollection.get(s.collectionId) ?? {};
    byStatus[s.status] = s._count;
    statusByCollection.set(s.collectionId, byStatus);
  }
  const tokensByCollection = new Map<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number }
  >();
  for (const row of tokenSums) {
    const input = Number(row.inputTokens ?? 0);
    const output = Number(row.outputTokens ?? 0);
    const acc = tokensByCollection.get(row.collectionId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    acc.inputTokens += input;
    acc.outputTokens += output;
    acc.costUsd += usageCostUsd(row.model, input, output);
    tokensByCollection.set(row.collectionId, acc);
  }

  const collectionsWithStats = collections.map((c) => {
    const byStatus = statusByCollection.get(c.id) ?? {};
    const tokens = tokensByCollection.get(c.id);
    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;
    const costUsd = tokens?.costUsd ?? 0;

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
  });

  return NextResponse.json(collectionsWithStats);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveUserId(request);
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
