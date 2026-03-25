import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';
import { sendVerificationEmail } from '@/lib/infrastructure/verification';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { name, email: rawEmail, password } =
    (body as { name?: string; email?: string; password?: string }) ?? {};

  if (!rawEmail || !password) {
    return NextResponse.json({ error: 'Email a heslo jsou povinné' }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();

  if (password.length < 6) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 6 znaků' }, { status: 400 });
  }

  // Check existing user
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.emailVerified) {
      return NextResponse.json(
        { error: 'Uživatel s tímto emailem již existuje' },
        { status: 409 },
      );
    }
    // Unverified — delete and re-create
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      name: name?.trim() || null,
      email,
      password: hashedPassword,
    },
  });

  try {
    await sendVerificationEmail(email);
  } catch (err) {
    console.error('[register] Failed to send verification email:', err);
    // User is created but email failed — they can use "resend" later
  }

  return NextResponse.json(
    { message: 'Ověřovací email odeslán', email },
    { status: 201 },
  );
}
