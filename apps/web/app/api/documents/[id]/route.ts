import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      translations: true,
      glossary: true,
    },
  });

  if (!doc) {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }

  return NextResponse.json(doc);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  try {
    await prisma.document.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }
}
