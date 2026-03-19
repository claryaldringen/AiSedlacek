import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { slug } = await params;

  const publicSlug = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!publicSlug) {
    return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
  }

  if (publicSlug.targetType === 'collection') {
    const collection = await prisma.collection.findUnique({
      where: { id: publicSlug.targetId },
      include: {
        pages: {
          orderBy: { order: 'asc' },
          include: {
            document: {
              include: {
                translations: { select: { language: true, text: true } },
                glossary: { select: { term: true, definition: true } },
              },
            },
          },
        },
      },
    });

    if (!collection || !collection.isPublic) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }

    return NextResponse.json({
      type: 'collection',
      name: collection.name,
      description: collection.description,
      context: collection.context,
      pages: collection.pages.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        thumbnailUrl: p.thumbnailUrl,
        imageUrl: p.imageUrl,
        status: p.status,
        order: p.order,
        document: p.document
          ? {
              transcription: p.document.transcription,
              detectedLanguage: p.document.detectedLanguage,
              context: p.document.context,
              translations: p.document.translations,
              glossary: p.document.glossary,
            }
          : null,
      })),
    });
  }

  if (publicSlug.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: publicSlug.targetId },
      include: {
        document: {
          include: {
            translations: { select: { language: true, text: true } },
            glossary: { select: { term: true, definition: true } },
          },
        },
      },
    });

    if (!page || !page.isPublic) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }

    return NextResponse.json({
      type: 'page',
      displayName: page.displayName,
      imageUrl: page.imageUrl,
      status: page.status,
      document: page.document
        ? {
            transcription: page.document.transcription,
            detectedLanguage: page.document.detectedLanguage,
            context: page.document.context,
            translations: page.document.translations,
            glossary: page.document.glossary,
          }
        : null,
    });
  }

  return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
}
