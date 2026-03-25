import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ verified: true }); // fail safe
  }

  const { email: rawEmail } = (body as { email?: string }) ?? {};
  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ verified: true }); // fail safe
  }

  const email = rawEmail.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true },
  });

  // Non-existent user → true (prevent enumeration)
  if (!user) {
    return NextResponse.json({ verified: true });
  }

  return NextResponse.json({ verified: user.emailVerified !== null });
}
