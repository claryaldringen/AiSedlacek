import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { computeCostFromTokens } from '@/lib/pricing';

export async function GET(): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { pages: true } },
    },
  });

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Neplatné tělo požadavku' }, { status: 400 });
  }

  const { name, description } = body as { name?: unknown; description?: unknown };

  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'Název svazku je povinný' }, { status: 400 });
  }

  const collection = await prisma.collection.create({
    data: {
      userId,
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
    },
  });

  return NextResponse.json(collection, { status: 201 });
}
