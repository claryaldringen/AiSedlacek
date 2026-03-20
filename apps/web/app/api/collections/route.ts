import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';

export async function GET(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { pages: true } },
    },
  });

  // Add count of processable pages (pending + error) for each collection
  const collectionsWithCounts = await Promise.all(
    collections.map(async (c) => ({
      ...c,
      processableCount: await prisma.page.count({
        where: { collectionId: c.id, status: { in: ['pending', 'error'] } },
      }),
    })),
  );

  return NextResponse.json(collectionsWithCounts);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

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
