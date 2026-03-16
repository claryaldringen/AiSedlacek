import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(): Promise<NextResponse> {
  const collections = await prisma.collection.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { pages: true } },
    },
  });

  return NextResponse.json(collections);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
    },
  });

  return NextResponse.json(collection, { status: 201 });
}
