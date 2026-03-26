import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export const maxDuration = 10;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Translate collection context to another language.
 * Enqueues a job for the VPS worker.
 * POST body: { targetLanguage: string }
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { targetLanguage } = (body as { targetLanguage?: string }) ?? {};
  if (typeof targetLanguage !== 'string' || !targetLanguage.trim()) {
    return NextResponse.json({ error: 'Missing targetLanguage' }, { status: 400 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  if (!collection.context || collection.context.trim().length === 0) {
    return NextResponse.json({ error: 'No context to translate' }, { status: 400 });
  }

  const job = await prisma.processingJob.create({
    data: {
      userId,
      status: 'queued',
      type: 'translate-context',
      jobData: JSON.stringify({
        collectionId: id,
        targetLanguage,
        userId,
      }),
      totalPages: 1,
      completedPages: 0,
      pageIds: [],
      collectionId: id,
      currentStep: 'Queued — waiting for context translation…',
    },
  });

  return NextResponse.json({ jobId: job.id });
}
