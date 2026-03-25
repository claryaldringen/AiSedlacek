import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { cancelJob } from '@/lib/infrastructure/processing-jobs';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: t('notLoggedIn') }, { status: 401 });
  }

  const cancelled = cancelJob(userId);
  if (!cancelled) {
    return NextResponse.json({ error: t('noActiveProcessing') }, { status: 404 });
  }

  return NextResponse.json({ status: 'cancelled' });
}
