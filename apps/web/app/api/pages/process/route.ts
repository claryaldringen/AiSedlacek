import { NextRequest } from 'next/server';

import { prisma } from '@/lib/infrastructure/db';
import type { ProcessingMode } from '@ai-sedlacek/ocr';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { checkBalance } from '@/lib/infrastructure/billing';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

// ── POST: Start processing via BullMQ ───────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('pageIds' in body)) {
    return Response.json({ error: t('missingPageIds') }, { status: 400 });
  }

  const {
    pageIds,
    language,
    mode: rawMode,
    collectionId: rawCollectionId,
  } = body as {
    pageIds: unknown;
    language?: unknown;
    mode?: unknown;
    collectionId?: unknown;
  };

  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return Response.json({ error: t('pageIdsNotArray') }, { status: 400 });
  }

  // Verify all pages belong to the current user
  const ownedPages = await prisma.page.findMany({
    where: { id: { in: pageIds as string[] }, userId },
    select: { id: true, collectionId: true },
  });
  const ownedIds = new Set(ownedPages.map((p) => p.id));
  const unauthorizedIds = (pageIds as string[]).filter((pid) => !ownedIds.has(pid));
  if (unauthorizedIds.length > 0) {
    return Response.json({ error: t('somePagesUnauthorized') }, { status: 403 });
  }

  // Check token balance before starting
  const { balance, sufficient } = await checkBalance(userId);
  if (!sufficient) {
    return Response.json({ error: t('insufficientCredit'), balance }, { status: 402 });
  }

  const targetLang =
    typeof language === 'string' && language.trim() !== '' ? language.trim() : 'cs';
  const processingMode: ProcessingMode =
    rawMode === 'translate' ? 'translate' : 'transcribe+translate';
  const collectionId =
    typeof rawCollectionId === 'string'
      ? rawCollectionId
      : (ownedPages[0]?.collectionId ?? undefined);

  // Block duplicate OCR for the same collection (context ordering requires sequential processing)
  if (collectionId) {
    const existingOcrJob = await prisma.processingJob.findFirst({
      where: {
        userId,
        status: { in: ['running', 'queued'] },
        type: 'ocr',
        collectionId,
      },
      select: { id: true },
    });
    if (existingOcrJob) {
      return Response.json(
        { error: t('processingAlreadyRunning'), jobId: existingOcrJob.id },
        { status: 409 },
      );
    }
  }

  // Create ProcessingJob in DB with status 'queued' — worker picks it up
  const job = await prisma.processingJob.create({
    data: {
      userId,
      status: 'queued',
      totalPages: (pageIds as string[]).length,
      completedPages: 0,
      pageIds: pageIds as string[],
      language: targetLang,
      mode: processingMode,
      collectionId: collectionId ?? null,
      currentStep: 'Ve frontě — čeká na zpracování…',
    },
  });

  // Set all pages to status 'processing'
  await prisma.page.updateMany({
    where: { id: { in: pageIds as string[] } },
    data: { status: 'processing', errorMessage: null },
  });

  return Response.json({ jobId: job.id });
}

// ── GET: Check for running job (for reconnect support) ───────

export async function GET(request: NextRequest): Promise<Response> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  // Only reconnect to OCR jobs — non-OCR jobs (retranslate, generate-context, fix-contexts)
  // have their own polling loops started by the triggering UI action.
  const runningJob = await prisma.processingJob.findFirst({
    where: { userId, status: { in: ['running', 'queued'] }, type: 'ocr' },
    orderBy: { createdAt: 'desc' },
  });

  if (!runningJob) {
    return Response.json({ status: 'idle' });
  }

  return Response.json({
    status: 'running',
    jobId: runningJob.id,
    totalPages: runningJob.totalPages,
    completedPages: runningJob.completedPages,
    currentStep: runningJob.currentStep,
    errors: runningJob.errors,
  });
}
