import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { prisma } from '@/lib/infrastructure/db';

// On Vercel serverless, there is no persistent in-memory state.
// We cannot tell if a 'processing' page is actively being handled
// by another function instance. To avoid false positives (reporting
// pages as interrupted while they are still processing), we simply
// return empty — the automatic interruption banner won't trigger.
//
// Users can still manually reset stuck pages via POST to this endpoint.

export async function GET(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  // Never auto-detect interrupted pages on serverless
  void userId;
  return NextResponse.json({ count: 0, pageIds: [] });
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
