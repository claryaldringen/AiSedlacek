import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { prisma } from '@/lib/infrastructure/db';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

// GET /api/pages/process/status?jobId=xxx
// Returns current job status from DB

export async function GET(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: t('missingJobId') }, { status: 400 });
  }

  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return NextResponse.json({ error: t('jobNotFound') }, { status: 404 });
  }

  // Verify job belongs to user
  if (job.userId !== userId) {
    return NextResponse.json({ error: t('accessDenied') }, { status: 403 });
  }

  // Fetch current state of pages for progress detail
  const pages = await prisma.page.findMany({
    where: { id: { in: job.pageIds } },
    select: { id: true, status: true },
  });

  const donePages = pages.filter((p) => p.status === 'done').map((p) => p.id);
  const errorPages = pages.filter((p) => p.status === 'error').map((p) => p.id);

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    type: job.type,
    totalPages: job.totalPages,
    completedPages: job.completedPages,
    currentPageId: job.currentPageId,
    currentStep: job.currentStep,
    errors: job.errors,
    pageIds: job.pageIds,
    progress: job.totalPages > 0 ? Math.round((job.completedPages / job.totalPages) * 100) : 0,
    donePages,
    errorPages,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}

// POST /api/pages/process/status — cancel a job
// Body: { jobId, action: "cancel" }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: { jobId?: string; action?: string } = {};
  try {
    body = await request.json();
  } catch {
    // No body
  }

  const { jobId, action } = body;

  if (action !== 'cancel') {
    return NextResponse.json({ error: t('unknownAction') }, { status: 400 });
  }

  let job;
  if (jobId) {
    job = await prisma.processingJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: t('jobNotFound') }, { status: 404 });
    }
  } else {
    // Find the most recent running job for this user
    job = await prisma.processingJob.findFirst({
      where: { userId, status: { in: ['running', 'queued'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!job || (job.status !== 'running' && job.status !== 'queued')) {
    return NextResponse.json({ error: t('noActiveProcessing') }, { status: 404 });
  }

  // Set job status to cancelled
  await prisma.processingJob.update({
    where: { id: job.id },
    data: {
      status: 'cancelled',
      currentStep: 'Zrušeno uživatelem',
    },
  });

  // Reset any processing pages back to pending
  await prisma.page.updateMany({
    where: {
      id: { in: job.pageIds },
      status: 'processing',
    },
    data: { status: 'pending' },
  });

  return NextResponse.json({ status: 'cancelled', jobId: job.id });
}
