import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      field: true,
      source: true,
      model: true,
      createdAt: true,
      content: true,
    },
  });

  return NextResponse.json(versions);
}
