import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { resolveUserFromToken } from '@/lib/infrastructure/api-auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await resolveUserFromToken(
    request.headers.get('authorization'),
  );
  if (!userId) {
    return NextResponse.json({ error: 'Neplatný token' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Uživatel nenalezen' }, { status: 404 });
  }

  return NextResponse.json(user);
}
