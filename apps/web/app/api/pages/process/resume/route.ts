import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { resumeJob } from '@/lib/infrastructure/processing-jobs';

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const resumed = resumeJob(userId);
  if (!resumed) {
    return NextResponse.json({ error: 'Žádné pozastavené zpracování' }, { status: 404 });
  }

  return NextResponse.json({ status: 'resumed' });
}
