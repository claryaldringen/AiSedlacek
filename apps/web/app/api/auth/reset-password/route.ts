import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { bodyErrorResponse, readJsonBody } from '@/lib/infrastructure/read-body';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  // Nepřihlášená routa – tělo jen se stropem velikosti (viz read-body.ts).
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.error, t);
  const body = parsed.value;

  const { token, password } = (body as { token?: string; password?: string }) ?? {};

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: t('missingToken') }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: t('passwordRequired') }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: t('passwordTooShort') }, { status: 400 });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!resetToken) {
    return NextResponse.json({ error: t('invalidOrExpiredLink') }, { status: 400 });
  }

  if (resetToken.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    return NextResponse.json({ error: t('invalidOrExpiredLink') }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: resetToken.email },
    select: { id: true },
  });

  if (!user) {
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    return NextResponse.json({ error: t('invalidOrExpiredLink') }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.delete({ where: { id: resetToken.id } }),
  ]);

  return NextResponse.json({ message: t('passwordChangedSuccess') });
}
