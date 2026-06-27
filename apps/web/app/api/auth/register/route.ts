import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
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

  const {
    name,
    email: rawEmail,
    password,
  } = (body as { name?: string; email?: string; password?: string }) ?? {};

  if (!rawEmail || !password) {
    return NextResponse.json({ error: t('emailPasswordRequired') }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();

  if (password.length < 6) {
    return NextResponse.json({ error: t('passwordTooShort') }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  // Check existing user. NEVER delete an existing account here — this endpoint is
  // unauthenticated, and prisma.user.delete cascades to Account/Session/Collection/
  // Page/Workspace/ApiToken. A verified user, or any user with linked OAuth accounts
  // (whose emailVerified may be null but must not be destroyed), is treated as a
  // conflict. An unverified credentials-only account is re-registered in place via
  // UPDATE so a pending sign-up can be retried without data loss.
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { accounts: { select: { id: true } } },
  });
  if (existing) {
    if (existing.emailVerified || existing.accounts.length > 0) {
      return NextResponse.json({ error: t('userAlreadyExists') }, { status: 409 });
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: { name: name?.trim() || existing.name, password: hashedPassword },
    });
  } else {
    await prisma.user.create({
      data: {
        name: name?.trim() || null,
        email,
        password: hashedPassword,
      },
    });
  }

  try {
    await sendVerificationEmail(email, locale);
  } catch (err) {
    console.error('[register] Failed to send verification email:', err);
    // User is created but email failed — they can use "resend" later
  }

  return NextResponse.json({ message: t('verificationEmailSent'), email }, { status: 201 });
}
