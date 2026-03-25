import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { sendVerificationEmail } from '@/lib/infrastructure/verification';
import { getApiTranslations, getLocaleFromRequest } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');
  const locale = getLocaleFromRequest(request);

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

  const sent = await sendVerificationEmail(email, locale);
  if (!sent) {
    // Rate limited — return 200 with rateLimited flag (anti-enumeration: no 429)
    return NextResponse.json({ message: successMessage, rateLimited: true });
  }

  return NextResponse.json({ message: successMessage });
}
