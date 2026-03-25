import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getEmailProvider } from '@/lib/adapters/email';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { email: rawEmail } = (body as { email?: string }) ?? {};

  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'Email je povinný' }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();

  // Always return success to prevent email enumeration
  const successMessage = 'Pokud existuje účet s tímto emailem, obdržíte odkaz pro obnovení hesla.';

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

  await getEmailProvider().sendPasswordReset(email, resetUrl);

  return NextResponse.json({ message: successMessage });
}
