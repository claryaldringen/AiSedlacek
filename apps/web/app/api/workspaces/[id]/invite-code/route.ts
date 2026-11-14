import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { generateInviteCode } from '@/lib/infrastructure/workspace';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Vygeneruje nový pozvánkový kód sdíleného workspace – starý tím okamžitě
 * přestane platit. Smí jen vlastník; ostatní dostanou 404 (člen 403).
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id: workspaceId } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, type: true, ownerId: true, members: { select: { userId: true } } },
  });
  const isMember = workspace?.members.some((m) => m.userId === userId) ?? false;
  if (!workspace || workspace.type !== 'shared' || !isMember) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }
  if (workspace.ownerId !== userId) {
    return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
  }

  const inviteCode = generateInviteCode();
  await prisma.workspace.update({ where: { id: workspaceId }, data: { inviteCode } });

  return NextResponse.json({ inviteCode });
}
