import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawToken = request.nextUrl.searchParams.get('token');
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';

  if (!rawToken) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing-token`);
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await prisma.verificationToken.findFirst({
    where: { token: tokenHash },
  });

  if (!record || record.expires < new Date()) {
    // Clean up expired token if found
    if (record) {
      await prisma.verificationToken.delete({
        where: { identifier_token: { identifier: record.identifier, token: record.token } },
      });
    }
    return NextResponse.redirect(`${baseUrl}/login?error=invalid-token`);
  }

  const user = await prisma.user.findUnique({ where: { email: record.identifier } });
  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid-token`);
  }

  // Atomic: set emailVerified + delete token
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token: record.token } },
    }),
  ]);

  return NextResponse.redirect(`${baseUrl}/login?verified=true`);
}
