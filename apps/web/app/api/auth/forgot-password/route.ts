import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getEmailProvider } from '@/lib/adapters/email';
import { rateLimit, clientIp } from '@/lib/infrastructure/rate-limit';
import { getApiTranslations, getLocaleFromRequest } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');
  const locale = getLocaleFromRequest(request);

  // Per-IP throttle (independent of whether the email exists → no enumeration).
  const rl = rateLimit(`forgot:${clientIp(request)}`, 10, 60 * 60 * 1000);
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

  // Always return success to prevent email enumeration
  const successMessage = t('forgotPasswordSuccess');

  // Delete any existing tokens for this email
  await prisma.passwordResetToken.deleteMany({ where: { email } });

  // Check if user exists and has a password (not OAuth-only)
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  });

  if (!user || !user.password) {
    return NextResponse.json({ message: successMessage });
  }

  // Generate token and store hash
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await prisma.passwordResetToken.create({
    data: {
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  await (await getEmailProvider()).sendPasswordReset(email, resetUrl, locale);

  return NextResponse.json({ message: successMessage });
}
