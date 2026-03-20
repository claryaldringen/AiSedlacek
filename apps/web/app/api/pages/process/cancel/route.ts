import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { cancelJob } from '@/lib/infrastructure/processing-jobs';

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const cancelled = cancelJob(userId);
  if (!cancelled) {
    return NextResponse.json({ error: 'Žádné aktivní zpracování' }, { status: 404 });
  }

  return NextResponse.json({ status: 'cancelled' });
}
