import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { order: 'asc' },
        include: {
          document: {
            select: {
              id: true,
              detectedLanguage: true,
              translations: { select: { language: true } },
            },
          },
        },
      },
    },
  });

  if (!collection) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  return NextResponse.json(collection);
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Neplatné tělo požadavku' }, { status: 400 });
  }

  const { name, description, context, contextUrl } = body as {
    name?: unknown; description?: unknown; context?: unknown; contextUrl?: unknown;
  };

  const data: { name?: string; description?: string; context?: string; contextUrl?: string | null } = {};
  if (typeof name === 'string' && name.trim() !== '') {
    data.name = name.trim();
  }
  if (typeof description === 'string') {
    data.description = description.trim();
  }
  if (typeof context === 'string') {
    data.context = context;
  }
  if ('contextUrl' in (body as object)) {
    data.contextUrl = typeof contextUrl === 'string' && contextUrl.trim() !== '' ? contextUrl.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nic k aktualizaci' }, { status: 400 });
  }

  try {
    const updated = await prisma.collection.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  try {
    // Orphan pages: set collectionId to null (done by onDelete: SetNull in schema)
    await prisma.collection.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }
}
