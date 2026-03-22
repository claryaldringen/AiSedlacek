import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { generateUniqueSlug, validateSlug } from '@/lib/infrastructure/slugify';
import { requireUserId } from '@/lib/auth';
import { PUBLIC_WORKSPACE_ID } from '@/lib/infrastructure/workspace';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { order: 'asc' },
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
  });

  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  return NextResponse.json(collection);
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
    }

    const { id } = await params;

    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection || collection.userId !== userId) {
      return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Neplatné tělo požadavku' }, { status: 400 });
    }

    const {
      name,
      description,
      context,
      contextUrls,
      isPublic,
      slug,
      title,
      author,
      yearFrom,
      yearTo,
      librarySignature,
      abstract: abstractText,
    } = body as {
      name?: unknown;
      description?: unknown;
      context?: unknown;
      contextUrls?: unknown;
      isPublic?: unknown;
      slug?: unknown;
      title?: unknown;
      author?: unknown;
      yearFrom?: unknown;
      yearTo?: unknown;
      librarySignature?: unknown;
      abstract?: unknown;
    };

    const data: {
      name?: string;
      description?: string;
      context?: string;
      contextUrls?: string[];
      isPublic?: boolean;
      slug?: string | null;
      title?: string | null;
      author?: string | null;
      yearFrom?: number | null;
      yearTo?: number | null;
      librarySignature?: string | null;
      abstract?: string | null;
    } = {};

    if (typeof name === 'string' && name.trim() !== '') {
      data.name = name.trim();
    }
    if (typeof description === 'string') {
      data.description = description.trim();
    }
    if (typeof context === 'string') {
      data.context = context;
    }
    if (Array.isArray(contextUrls)) {
      data.contextUrls = contextUrls
        .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
        .map((u) => u.trim());
    }

    // Structured metadata fields
    if (typeof title === 'string') {
      data.title = title.trim() || null;
    } else if (title === null) {
      data.title = null;
    }
    if (typeof author === 'string') {
      data.author = author.trim() || null;
    } else if (author === null) {
      data.author = null;
    }
    if (typeof yearFrom === 'number') {
      data.yearFrom = yearFrom;
    } else if (yearFrom === null) {
      data.yearFrom = null;
    }
    if (typeof yearTo === 'number') {
      data.yearTo = yearTo;
    } else if (yearTo === null) {
      data.yearTo = null;
    }
    if (typeof librarySignature === 'string') {
      data.librarySignature = librarySignature.trim() || null;
    } else if (librarySignature === null) {
      data.librarySignature = null;
    }
    if (typeof abstractText === 'string') {
      data.abstract = abstractText.trim() || null;
    } else if (abstractText === null) {
      data.abstract = null;
    }

    // Process sharing fields before empty-check
    let sharingFieldsPresent = false;
    let resolvedSlug: string | null = null;

    if (typeof isPublic === 'boolean') {
      data.isPublic = isPublic;
      sharingFieldsPresent = true;

      if (isPublic) {
        if (typeof slug === 'string' && slug.trim() !== '') {
          const slugError = validateSlug(slug.trim());
          if (slugError) {
            return NextResponse.json({ error: slugError }, { status: 400 });
          }
          resolvedSlug = slug.trim();
        } else {
          resolvedSlug = await generateUniqueSlug(collection.name);
        }
        data.slug = resolvedSlug;
      } else {
        data.slug = null;
        resolvedSlug = null;
      }
    } else if (typeof slug === 'string') {
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
      return NextResponse.json({ error: 'Nic k aktualizaci' }, { status: 400 });
    }

    if (sharingFieldsPresent) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.publicSlug.deleteMany({ where: { targetId: id } });

        if (data.isPublic && resolvedSlug) {
          await tx.publicSlug.create({
            data: {
              slug: resolvedSlug,
              targetType: 'collection',
              targetId: id,
            },
          });

          // Add to public workspace (ensure it exists first)
          await tx.workspace.upsert({
            where: { id: PUBLIC_WORKSPACE_ID },
            create: { id: PUBLIC_WORKSPACE_ID, name: 'Veřejné dokumenty', type: 'public' },
            update: {},
          });
          // Use upsert-like pattern: delete then create to avoid unique constraint errors
          await tx.workspaceItem.deleteMany({
            where: { workspaceId: PUBLIC_WORKSPACE_ID, collectionId: id },
          });
          await tx.workspaceItem.create({
            data: { workspaceId: PUBLIC_WORKSPACE_ID, collectionId: id },
          });
        } else {
          // Remove from public workspace when unpublishing
          await tx.workspaceItem.deleteMany({
            where: { workspaceId: PUBLIC_WORKSPACE_ID, collectionId: id },
          });
        }

        return tx.collection.update({
          where: { id },
          data,
        });
      });
      return NextResponse.json(updated);
    }

    const updated = await prisma.collection.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[collections/PATCH] Error:', err);
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Tento slug je již obsazený' }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { id } = await params;

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.publicSlug.deleteMany({ where: { targetId: id } });
      // Orphan pages: set collectionId to null (done by onDelete: SetNull in schema)
      await tx.collection.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }
}
