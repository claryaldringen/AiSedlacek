import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { sendVerificationEmail } from '@/lib/infrastructure/verification';
import { rateLimit, clientIp } from '@/lib/infrastructure/rate-limit';
import { getApiTranslations, getLocaleFromRequest } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');
  const locale = getLocaleFromRequest(request);

  // Per-IP throttle to limit mail-bombing.
  const rl = rateLimit(`send-verification:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: t('rateLimited'), retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { email: rawEmail } = (body as { email?: string }) ?? {};
  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: t('emailRequired') }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();
  const successMessage = t('sendVerificationSuccess');

  // Silent success for non-existent, OAuth-only, or already-verified users
  const user = await prisma.user.findUnique({
    where: { email },
    select: { password: true, emailVerified: true },
  });

  if (!user || !user.password || user.emailVerified) {
    return NextResponse.json({ message: successMessage });
  }

  // Always return the identical generic response. Previously a `rateLimited: true`
  // flag was only ever returned for an existing, unverified, credentials account
  // — an account-enumeration oracle.
  await sendVerificationEmail(email, locale);
  return NextResponse.json({ message: successMessage });
}
