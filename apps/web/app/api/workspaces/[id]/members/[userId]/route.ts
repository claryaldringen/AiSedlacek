import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { removeWorkspaceMember } from '@/lib/infrastructure/workspace';

type RouteContext = { params: Promise<{ id: string; userId: string }> };

/**
 * Odebrání člena ze sdíleného workspace.
 *
 * - Vlastník odebere jiného člena: jeho svazky a stránky z workspace zmizí
 *   a pozvánkový kód se změní (jinak by se vyhozený člen starým kódem vrátil).
 * - Člen odebere sám sebe (opuštění workspace): jeho svazky a stránky z workspace
 *   zmizí, kód zůstává.
 * - Vlastník workspace opustit nemůže (workspace by zůstal bez vlastníka) – může
 *   ho smazat.
 *
 * Kdo není členem, dostane 404 (cizí workspace se navenek nijak neprozrazuje).
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id: workspaceId, userId: targetUserId } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, type: true, ownerId: true, members: { select: { userId: true } } },
  });
  const isMember = workspace?.members.some((m) => m.userId === userId) ?? false;
  if (!workspace || workspace.type !== 'shared' || !isMember) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  const leaving = targetUserId === userId;
  const isOwner = workspace.ownerId === userId;
  if (leaving && isOwner) {
    return NextResponse.json({ error: t('ownerCannotLeaveWorkspace') }, { status: 400 });
  }
  if (!leaving && !isOwner) {
    return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
  }
  if (!workspace.members.some((m) => m.userId === targetUserId)) {
    return NextResponse.json({ error: t('memberNotFound') }, { status: 404 });
  }

  const { inviteCode, removedItems } = await removeWorkspaceMember(workspaceId, targetUserId, {
    rotateInvite: !leaving,
  });

  return NextResponse.json({
    ok: true,
    removedItems,
    // Nový kód vidí jen vlastník (jen on ho může rotovat)
    inviteCode: isOwner ? inviteCode : null,
  });
}
