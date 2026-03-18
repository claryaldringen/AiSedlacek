import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { name, email, password } = (body as { name?: string; email?: string; password?: string }) ?? {};

  if (!email || !password) {
    return NextResponse.json({ error: 'Email a heslo jsou povinné' }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 6 znaků' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Uživatel s tímto emailem již existuje' }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: name?.trim() || null,
      email,
      password: hashedPassword,
    },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
