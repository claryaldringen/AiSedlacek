import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { PUBLIC_WORKSPACE_ID } from '@/lib/infrastructure/workspace';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      items: {
        include: {
          collection: {
            include: {
              _count: { select: { pages: true } },
            },
          },
          page: {
            include: {
              document: {
                select: {
                  id: true,
                  detectedLanguage: true,
                  translations: { select: { language: true } },
                },
              },
            },
          },
        },
        orderBy: { addedAt: 'desc' },
      },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  // Access check: public workspace is accessible to all authenticated users;
  // otherwise user must be a member
  if (workspace.id !== PUBLIC_WORKSPACE_ID) {
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember) {
      return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
    }
  }

  // Separate collections and orphan pages for convenience
  const collections = workspace.items
    .filter((item) => item.collection !== null)
    .map((item) => item.collection);
  const orphanPages = workspace.items.filter((item) => item.page !== null).map((item) => item.page);

  return NextResponse.json({
    ...workspace,
    collections,
    orphanPages,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: { members: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  // Only shared workspaces can be renamed, and only by owner
  if (workspace.type !== 'shared') {
    return NextResponse.json({ error: t('cannotEditWorkspace') }, { status: 403 });
  }

  if (workspace.ownerId !== userId) {
    return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
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

  const { name } = body as { name?: unknown };

  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: t('workspaceNameRequired') }, { status: 400 });
  }

  const updated = await prisma.workspace.update({
    where: { id },
    data: { name: name.trim() },
    include: {
      _count: { select: { items: true, members: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');
  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({ where: { id } });

  if (!workspace) {
    return NextResponse.json({ error: t('workspaceNotFound') }, { status: 404 });
  }

  // Cannot delete home or public workspaces
  if (workspace.type !== 'shared') {
    return NextResponse.json({ error: t('cannotDeleteWorkspace') }, { status: 403 });
  }

  if (workspace.ownerId !== userId) {
    return NextResponse.json({ error: t('insufficientPermissions') }, { status: 403 });
  }

  await prisma.workspace.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
