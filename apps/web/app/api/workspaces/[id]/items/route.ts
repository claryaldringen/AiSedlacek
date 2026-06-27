import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { PUBLIC_WORKSPACE_ID } from '@/lib/infrastructure/workspace';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id: workspaceId } = await params;

  // Verify workspace exists and user is a member (or it's the public workspace being managed by the system)
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { members: { select: { userId: true } } },
  });

  if (!workspace) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  // For non-public workspaces, user must be a member
  if (workspace.id !== PUBLIC_WORKSPACE_ID) {
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const { collectionId, pageId } = body as { collectionId?: unknown; pageId?: unknown };

  if (!collectionId && !pageId) {
    return NextResponse.json({ error: t('mustProvideCollectionOrPage') }, { status: 400 });
  }

  if (collectionId && pageId) {
    return NextResponse.json({ error: t('cannotAddBoth') }, { status: 400 });
  }

  const isPublicWorkspace = workspace.id === PUBLIC_WORKSPACE_ID;

  // Validate the referenced entity exists and belongs to user
  if (typeof collectionId === 'string') {
    const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection || collection.userId !== userId) {
      return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
    }
    // Adding to the public workspace must go through publishing (isPublic), not a
    // direct item insert that would bypass the share flow.
    if (isPublicWorkspace && !collection.isPublic) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }

    const item = await prisma.workspaceItem
      .create({ data: { workspaceId, collectionId } })
      .catch((e: unknown) => {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return null;
        throw e;
      });
    return NextResponse.json(item ?? { ok: true }, { status: item ? 201 : 200 });
  }

  if (typeof pageId === 'string') {
    const page = await prisma.page.findUnique({ where: { id: pageId } });
    if (!page || page.userId !== userId) {
      return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
    }
    if (isPublicWorkspace && !page.isPublic) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }

    const item = await prisma.workspaceItem
      .create({ data: { workspaceId, pageId } })
      .catch((e: unknown) => {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return null;
        throw e;
      });
    return NextResponse.json(item ?? { ok: true }, { status: item ? 201 : 200 });
  }

  return NextResponse.json({ error: t('invalidItemType') }, { status: 400 });
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id: workspaceId } = await params;

  // Verify workspace exists and user is a member
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { members: { select: { userId: true } } },
  });

  if (!workspace) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  if (workspace.id !== PUBLIC_WORKSPACE_ID) {
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const { collectionId, pageId } = body as { collectionId?: unknown; pageId?: unknown };

  // Only the item's owner (or the workspace owner) may remove it — otherwise any
  // co-member could unshare another member's collection/page (vandalism).
  const isWorkspaceOwner = workspace.ownerId === userId;

  if (typeof collectionId === 'string') {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      select: { userId: true },
    });
    if (!isWorkspaceOwner && collection?.userId !== userId) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }
    await prisma.workspaceItem.deleteMany({
      where: { workspaceId, collectionId },
    });
    return NextResponse.json({ ok: true });
  }

  if (typeof pageId === 'string') {
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { userId: true },
    });
    if (!isWorkspaceOwner && page?.userId !== userId) {
      return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
    }
    await prisma.workspaceItem.deleteMany({
      where: { workspaceId, pageId },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: t('mustProvideCollectionOrPage') }, { status: 400 });
}
