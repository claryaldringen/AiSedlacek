import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { checkBalance } from '@/lib/infrastructure/billing';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export const maxDuration = 10;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Generate collection context from transcriptions of selected pages.
 * Enqueues a job for the VPS worker instead of calling Claude directly.
 * POST body: { pageIds: string[] }
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: t('notLoggedIn') }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { pageIds } = (body as { pageIds?: string[] }) ?? {};
  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return NextResponse.json({ error: t('missingPageIds') }, { status: 400 });
  }

  // Verify collection belongs to user
  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  // Check token balance before enqueuing
  const { balance, sufficient } = await checkBalance(userId);
  if (!sufficient) {
    return NextResponse.json({ error: t('insufficientCredit'), balance }, { status: 402 });
  }

  // Create ProcessingJob for the worker to pick up
  const job = await prisma.processingJob.create({
    data: {
      userId,
      status: 'queued',
      type: 'generate-context',
      jobData: JSON.stringify({
        collectionId: id,
        pageIds,
        userId,
      }),
      totalPages: 2, // context generation + metadata extraction
      completedPages: 0,
      pageIds: [],
      collectionId: id,
      currentStep: 'Ve frontě — čeká na generování kontextu…',
    },
  });

  return NextResponse.json({ jobId: job.id });
}
