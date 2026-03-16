import { NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(): Promise<NextResponse> {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      translations: { select: { language: true } },
      _count: { select: { glossary: true } },
    },
  });

  return NextResponse.json(documents);
}
