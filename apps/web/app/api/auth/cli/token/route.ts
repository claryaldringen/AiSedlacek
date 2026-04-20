import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'node:crypto';
import { prisma } from '@/lib/infrastructure/db';
import { hashToken, resolveUserFromToken } from '@/lib/infrastructure/api-auth';
import { requireUserId } from '@/lib/auth';

// POST: Exchange session auth for API token (called after OAuth consent)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireUserId();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);

    await prisma.apiToken.create({
      data: {
        userId,
        tokenHash,
        name: 'CLI',
      },
    });

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }
}

// DELETE: Revoke API token
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const userId = await resolveUserFromToken(authHeader);
  if (!userId) {
    return NextResponse.json({ error: 'Neplatný token' }, { status: 401 });
  }

  const token = authHeader!.slice(7);
  const tokenHash = hashToken(token);

  await prisma.apiToken.delete({
    where: { tokenHash },
  });

  return NextResponse.json({ ok: true });
}
