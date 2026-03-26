import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { generateUniqueSlug, validateSlug } from '@/lib/infrastructure/slugify';
import { getStorage } from '@/lib/adapters/storage';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  const page = await prisma.page.findUnique({
    where: { id },
    include: {
      document: {
        include: {
          translations: true,
          glossary: true,
        },
      },
    },
  });

  if (!page || page.userId !== userId) {
    return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
  }

  return NextResponse.json(page);
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.userId !== userId) {
    return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
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

  const { collectionId, order, status, displayName, isPublic, slug } = body as {
    collectionId?: unknown;
    order?: unknown;
    status?: unknown;
    displayName?: unknown;
    isPublic?: unknown;
    slug?: unknown;
  };

  const data: {
    collectionId?: string | null;
    order?: number;
    status?: string;
    displayName?: string | null;
    isPublic?: boolean;
    slug?: string | null;
  } = {};

  if ('collectionId' in (body as object)) {
    data.collectionId =
      collectionId === null || collectionId === undefined
        ? null
        : typeof collectionId === 'string'
          ? collectionId
          : undefined;
  }

  if (typeof order === 'number') {
    data.order = order;
  }

  if (typeof status === 'string') {
    data.status = status;
  }

  if ('displayName' in (body as object)) {
    data.displayName =
      typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : null;
  }

  // Process sharing fields before empty-check
  let sharingFieldsPresent = false;
  let resolvedSlug: string | null = null;

  if (typeof isPublic === 'boolean') {
    data.isPublic = isPublic;
    sharingFieldsPresent = true;

    if (isPublic) {
      if (typeof slug === 'string' && slug.trim() !== '') {
        // Validate the provided slug
        const slugError = validateSlug(slug.trim());
        if (slugError) {
          return NextResponse.json({ error: slugError }, { status: 400 });
        }
        resolvedSlug = slug.trim();
      } else {
        // Auto-generate a unique slug from displayName or fallback
        const slugSource = page.displayName ?? 'page-' + id.slice(0, 8);
        resolvedSlug = await generateUniqueSlug(slugSource);
      }
      data.slug = resolvedSlug;
    } else {
      // Making private — clear slug
      data.slug = null;
      resolvedSlug = null;
    }
  } else if (typeof slug === 'string') {
    // slug provided without isPublic — validate and set
    sharingFieldsPresent = true;
    const slugTrimmed = slug.trim();
    if (slugTrimmed !== '') {
      const slugError = validateSlug(slugTrimmed);
      if (slugError) {
        return NextResponse.json({ error: slugError }, { status: 400 });
      }
      resolvedSlug = slugTrimmed;
      data.slug = resolvedSlug;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: t('nothingToUpdate') }, { status: 400 });
  }

  try {
    let updated;

    if (sharingFieldsPresent) {
      updated = await prisma.$transaction(async (tx) => {
        // Remove old PublicSlug for this entity
        await tx.publicSlug.deleteMany({ where: { targetId: id } });

        // Create new PublicSlug if now public
        if (data.isPublic && resolvedSlug) {
          await tx.publicSlug.create({
            data: {
              slug: resolvedSlug,
              targetType: 'page',
              targetId: id,
            },
          });
        }

        return tx.page.update({
          where: { id },
          data,
        });
      });
    } else {
      updated = await prisma.page.update({
        where: { id },
        data,
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json({ error: t('slugTaken') }, { status: 409 });
    }
    return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  try {
    const page = await prisma.page.findUnique({ where: { id } });
    if (!page || page.userId !== userId) {
      return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
    }

    // Delete file from storage
    const storage = getStorage();
    const filename = page.imageUrl.replace('/api/images/', '');
    try {
      await storage.delete(filename);
    } catch {
      // File may already be missing – continue
    }

    await prisma.$transaction(async (tx) => {
      await tx.publicSlug.deleteMany({ where: { targetId: id } });
      await tx.page.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: t('pageNotFound') }, { status: 404 });
  }
}
