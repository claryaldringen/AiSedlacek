import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { cancelJob } from '@/lib/infrastructure/processing-jobs';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const cancelled = cancelJob(userId);
  if (!cancelled) {
    return NextResponse.json({ error: t('noActiveProcessing') }, { status: 404 });
  }

  return NextResponse.json({ status: 'cancelled' });
}
