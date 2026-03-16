import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  const page = await prisma.page.findUnique({
    where: { id },
    include: {
      document: {
        include: {
          translations: true,
          glossary: true,
        },
      },
    },
  });

  if (!page) {
    return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
  }

  return NextResponse.json(page);
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

  const { collectionId, order, status } = body as {
    collectionId?: unknown;
    order?: unknown;
    status?: unknown;
  };

  const data: { collectionId?: string | null; order?: number; status?: string } = {};

  if ('collectionId' in (body as object)) {
    data.collectionId =
      collectionId === null || collectionId === undefined
        ? null
        : typeof collectionId === 'string'
          ? collectionId
          : undefined;
  }

  if (typeof order === 'number') {
    data.order = order;
  }

  if (typeof status === 'string') {
    data.status = status;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nic k aktualizaci' }, { status: 400 });
  }

  try {
    const updated = await prisma.page.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const page = await prisma.page.findUnique({ where: { id } });
    if (!page) {
      return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
    }

    // Delete file from storage
    const storage = new LocalStorageProvider();
    const filename = page.imageUrl.replace('/api/images/', '');
    try {
      await storage.delete(filename);
    } catch {
      // File may already be missing – continue
    }

    await prisma.page.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
  }
}
