import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { requireCredit } from '@/lib/infrastructure/credit';
import {
  LLM_MAX_TOKENS,
  TEXT_MODEL,
  estimateInputTokens,
  reservationCredits,
} from '@ai-sedlacek/shared';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fix document-level contexts against collection context.
 * Enqueues a job for the VPS worker instead of running SSE directly.
 * POST body: (none)
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

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
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  if (!collection.context) {
    return NextResponse.json({ error: t('collectionHasNoContext') }, { status: 422 });
  }

  if (collection.pages.length === 0) {
    return NextResponse.json({ error: t('noProcessedDocuments') }, { status: 422 });
  }

  // Předběžná kontrola volného kreditu na opravu aspoň prvního dokumentu (BIL-1);
  // worker rezervuje před každým dokumentem a při nedostatku zbytek nezpracuje.
  const noCredit = await requireCredit(
    request,
    t,
    userId,
    reservationCredits(
      [TEXT_MODEL],
      estimateInputTokens(collection.context),
      LLM_MAX_TOKENS.fixContext,
    ),
  );
  if (noCredit) return noCredit;

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
