import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { checkBalance } from '@/lib/infrastructure/billing';

export const maxDuration = 10;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fix document-level contexts against collection context.
 * Enqueues a job for the VPS worker instead of running SSE directly.
 * POST body: (none)
 */
export async function POST(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { id } = await params;

  // Verify collection belongs to user and has context
  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      pages: {
        where: { status: 'done', document: { isNot: null } },
        select: { id: true },
      },
    },
  });

  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  if (!collection.context) {
    return NextResponse.json({ error: 'Svazek nemá kontext' }, { status: 422 });
  }

  if (collection.pages.length === 0) {
    return NextResponse.json({ error: 'Žádné zpracované dokumenty' }, { status: 422 });
  }

  // Check token balance before enqueuing
  const { balance, sufficient } = await checkBalance(userId);
  if (!sufficient) {
    return NextResponse.json({ error: 'Nedostatečný kredit', balance }, { status: 402 });
  }

  // Create ProcessingJob for the worker to pick up
  const job = await prisma.processingJob.create({
    data: {
      userId,
      status: 'queued',
      type: 'fix-contexts',
      jobData: JSON.stringify({
        collectionId: id,
        userId,
      }),
      totalPages: collection.pages.length,
      completedPages: 0,
      pageIds: [],
      collectionId: id,
      currentStep: 'Ve frontě — čeká na opravu kontextů…',
    },
  });

  return NextResponse.json({ jobId: job.id });
}
