import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const { inviteCode } = body as { inviteCode?: unknown };

  if (typeof inviteCode !== 'string' || inviteCode.trim() === '') {
    return NextResponse.json({ error: t('invalidInviteCode') }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { inviteCode: inviteCode.trim() },
    include: { members: { select: { userId: true } } },
  });

  if (!workspace) {
    return NextResponse.json({ error: t('invalidInviteCode') }, { status: 404 });
  }

  if (workspace.type !== 'shared') {
    return NextResponse.json({ error: t('cannotJoinWorkspace') }, { status: 403 });
  }

  // Check if already a member
  const alreadyMember = workspace.members.some((m) => m.userId === userId);
  if (alreadyMember) {
    return NextResponse.json({ error: t('alreadyMember') }, { status: 409 });
  }

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId,
      role: 'member',
    },
  });

  const result = await prisma.workspace.findUnique({
    where: { id: workspace.id },
    include: {
      _count: { select: { items: true, members: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(result);
}
