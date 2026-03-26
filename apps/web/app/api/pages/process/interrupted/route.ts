import { NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

// On Vercel serverless, there is no persistent in-memory state.
// We cannot tell if a 'processing' page is actively being handled
// by another function instance. To avoid false positives (reporting
// pages as interrupted while they are still processing), we simply
// return empty — the automatic interruption banner won't trigger.
//
// Users can still manually reset stuck pages via POST to this endpoint.

export async function GET(): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  // Never auto-detect interrupted pages on serverless
  void userId;
  return NextResponse.json({ count: 0, pageIds: [] });
}

export async function POST(): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const result = await prisma.page.updateMany({
    where: { userId, status: 'processing' },
    data: { status: 'pending' },
  });

  return NextResponse.json({ reset: result.count });
}
