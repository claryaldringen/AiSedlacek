import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { getActiveJob } from '@/lib/infrastructure/processing-jobs';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  // If there's an active job, pages aren't truly interrupted
  const job = getActiveJob(userId);
  if (job && !job.completed) {
    return NextResponse.json({ count: 0, pageIds: [] });
  }

  const pages = await prisma.page.findMany({
    where: { userId, status: 'processing' },
    select: { id: true },
  });

  return NextResponse.json({
    count: pages.length,
    pageIds: pages.map((p) => p.id),
  });
}

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const result = await prisma.page.updateMany({
    where: { userId, status: 'processing' },
    data: { status: 'pending' },
  });

  return NextResponse.json({ reset: result.count });
}
