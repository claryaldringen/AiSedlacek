import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { routing } from '@/i18n/routing';

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { locale } = (body as { locale?: string }) ?? {};

  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    return NextResponse.json(
      { error: `Invalid locale. Supported: ${routing.locales.join(', ')}` },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { locale },
  });

  const response = NextResponse.json({ locale });
  response.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  });
  return response;
}

export async function GET(): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return NextResponse.json({ locale: null });
  const { userId } = auth;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });

  return NextResponse.json({ locale: user?.locale ?? null });
}
