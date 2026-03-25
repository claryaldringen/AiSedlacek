import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { token, password } = (body as { token?: string; password?: string }) ?? {};

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Chybějící token' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Heslo je povinné' }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 6 znaků' }, { status: 400 });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!resetToken) {
    return NextResponse.json({ error: 'Neplatný nebo expirovaný odkaz' }, { status: 400 });
  }

  if (resetToken.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    return NextResponse.json({ error: 'Neplatný nebo expirovaný odkaz' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: resetToken.email },
    select: { id: true },
  });

  if (!user) {
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    return NextResponse.json({ error: 'Neplatný nebo expirovaný odkaz' }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.delete({ where: { id: resetToken.id } }),
  ]);

  return NextResponse.json({ message: 'Heslo bylo úspěšně změněno.' });
}
