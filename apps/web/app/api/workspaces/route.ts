import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { ensureWorkspaces, generateInviteCode } from '@/lib/infrastructure/workspace';

export async function GET(): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { homeId, publicId } = await ensureWorkspaces(userId);

  // Fetch all workspaces user has access to:
  // 1. Home workspace (owned, type 'home')
  // 2. Public workspace
  // 3. Shared workspaces where user is member
  const workspaces = await prisma.workspace.findMany({
    where: {
      OR: [{ id: homeId }, { id: publicId }, { members: { some: { userId } }, type: 'shared' }],
    },
    include: {
      _count: { select: { items: true, members: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(workspaces);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Neplatné tělo požadavku' }, { status: 400 });
  }

  const { name } = body as { name?: unknown };

  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'Název workspace je povinný' }, { status: 400 });
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: name.trim(),
      type: 'shared',
      ownerId: userId,
      inviteCode: generateInviteCode(),
      members: { create: { userId, role: 'owner' } },
    },
    include: {
      _count: { select: { items: true, members: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(workspace, { status: 201 });
}
