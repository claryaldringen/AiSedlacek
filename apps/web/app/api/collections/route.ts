import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/infrastructure/db';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { chargeForUsage } from '@/lib/pricing';
import { creditsToCzk } from '@ai-sedlacek/shared';
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
  const [statusCounts, tokenSums, ledgerSums] = collectionIds.length
    ? await Promise.all([
        prisma.page.groupBy({
          by: ['collectionId', 'status'],
          where: { collectionId: { in: collectionIds } },
          _count: true,
        }),
        // Po modelech – tokeny všech dokumentů a zvlášť tokeny dokumentů bez
        // záznamu skutečného odečtu (zpracované před BIL-11), jejichž cena se
        // odhaduje sazbou modelu, který dokument zpracoval.
        prisma.$queryRaw<
          {
            collectionId: string;
            model: string | null;
            inputTokens: bigint | null;
            outputTokens: bigint | null;
            legacyInputTokens: bigint | null;
            legacyOutputTokens: bigint | null;
          }[]
        >(Prisma.sql`
          SELECT p."collectionId" AS "collectionId",
                 d."model" AS "model",
                 SUM(d."inputTokens") AS "inputTokens",
                 SUM(d."outputTokens") AS "outputTokens",
                 SUM(CASE WHEN d."chargedCredits" IS NULL THEN d."inputTokens" END)
                   AS "legacyInputTokens",
                 SUM(CASE WHEN d."chargedCredits" IS NULL THEN d."outputTokens" END)
                   AS "legacyOutputTokens"
          FROM "Document" d
          JOIN "Page" p ON p."id" = d."pageId"
          WHERE p."collectionId" IN (${Prisma.join(collectionIds)})
          GROUP BY p."collectionId", d."model"
        `),
        // Skutečné odečty za svazek (BIL-11): OCR včetně odmítnutých pokusů
        // a regenerací, kopie, retranslace, kontexty i chat.
        prisma.tokenTransaction.groupBy({
          by: ['collectionId'],
          where: { collectionId: { in: collectionIds }, type: 'consumption' },
          _sum: { amount: true },
        }),
      ])
    : [[], [], []];

  const statusByCollection = new Map<string, Record<string, number>>();
  for (const s of statusCounts) {
    if (!s.collectionId) continue;
    const byStatus = statusByCollection.get(s.collectionId) ?? {};
    byStatus[s.status] = s._count;
    statusByCollection.set(s.collectionId, byStatus);
  }
  // Cena svazku (BIL-11) = součet skutečných odečtů z ledgeru + odhad za dokumenty
  // zpracované před zavedením záznamu odečtu (podle aktuálního ceníku; UI ukazuje
  // jen celkovou částku a odhad nerozlišuje). Dokument po další regeneraci záznam
  // dostane a z odhadu vypadne – nic se nezapočítá dvakrát.
  interface CollectionCharge {
    inputTokens: number;
    outputTokens: number;
    chargeCzk: number;
    chargeCredits: number;
    estimatedCredits: number;
  }
  const tokensByCollection = new Map<string, CollectionCharge>();
  const accFor = (collectionId: string): CollectionCharge => {
    const acc = tokensByCollection.get(collectionId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      chargeCzk: 0,
      chargeCredits: 0,
      estimatedCredits: 0,
    };
    tokensByCollection.set(collectionId, acc);
    return acc;
  };
  for (const row of tokenSums) {
    const acc = accFor(row.collectionId);
    acc.inputTokens += Number(row.inputTokens ?? 0);
    acc.outputTokens += Number(row.outputTokens ?? 0);
    const estimate = chargeForUsage(
      row.model,
      Number(row.legacyInputTokens ?? 0),
      Number(row.legacyOutputTokens ?? 0),
    );
    acc.chargeCzk += estimate?.czk ?? 0;
    acc.chargeCredits += estimate?.credits ?? 0;
    acc.estimatedCredits += estimate?.credits ?? 0;
  }
  for (const row of ledgerSums) {
    if (!row.collectionId) continue;
    const acc = accFor(row.collectionId);
    const credits = -(row._sum.amount ?? 0);
    acc.chargeCzk += creditsToCzk(credits);
    acc.chargeCredits += credits;
  }

  const collectionsWithStats = collections.map((c) => {
    const byStatus = statusByCollection.get(c.id) ?? {};
    const tokens = tokensByCollection.get(c.id);
    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;

    const isOwner = c.userId === userId;
    return {
      ...c,
      // Sdílené a veřejné workspacy obsahují cizí svazky – UI je nabízí jen ke čtení.
      canEdit: isOwner,
      processableCount: (byStatus['pending'] ?? 0) + (byStatus['error'] ?? 0),
      stats: {
        done: byStatus['done'] ?? 0,
        pending: byStatus['pending'] ?? 0,
        error: byStatus['error'] ?? 0,
        processing: byStatus['processing'] ?? 0,
        blank: byStatus['blank'] ?? 0,
        // Cena (skutečné odečty kreditu) i tokeny (z nich a veřejného ceníku se
        // dá cena dopočítat) jsou útrata vlastníka – čtenářům cizího svazku null,
        // UI je pak nezobrazí. Cena na 4 desetinná místa – formatCzk u haléřových
        // částek ukazuje víc míst.
        inputTokens: isOwner ? inputTokens : null,
        outputTokens: isOwner ? outputTokens : null,
        chargeCzk: isOwner ? Math.round((tokens?.chargeCzk ?? 0) * 10_000) / 10_000 : null,
        chargeCredits: isOwner ? (tokens?.chargeCredits ?? 0) : null,
        // Část ceny odhadnutá z tokenů (dokumenty bez záznamu odečtu); 0 = vše skutečné.
        // UI ji nezobrazuje – diagnostický údaj.
        chargeEstimatedCredits: isOwner ? (tokens?.estimatedCredits ?? 0) : null,
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
