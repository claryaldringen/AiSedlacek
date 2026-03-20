import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/infrastructure/db';
import { PublicResultViewer } from '@/components/PublicResultViewer';
import ImageZoom from '@/components/ImageZoom';

type Props = { params: Promise<{ slug: string; pageId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, pageId } = await params;

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps || ps.targetType !== 'collection') return { title: 'Nenalezeno' };

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { displayName: true, filename: true, collectionId: true },
  });
  if (!page || page.collectionId !== ps.targetId) return { title: 'Nenalezeno' };

  return { title: `${page.displayName ?? 'Dokument'} — AiSedlacek` };
}

export default async function PublicCollectionPageView({
  params,
}: Props): Promise<React.JSX.Element> {
  const { slug, pageId } = await params;

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps || ps.targetType !== 'collection') notFound();

  const collection = await prisma.collection.findUnique({
    where: { id: ps.targetId },
    select: { id: true, name: true, isPublic: true, context: true },
  });
  if (!collection || !collection.isPublic) notFound();

  const allPages = await prisma.page.findMany({
    where: { collectionId: collection.id },
    orderBy: { order: 'asc' },
    select: { id: true, displayName: true, filename: true, order: true },
  });

  const currentIndex = allPages.findIndex((p) => p.id === pageId);
  if (currentIndex === -1) notFound();

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      document: {
        include: {
          translations: { select: { language: true, text: true } },
          glossary: { select: { term: true, definition: true } },
        },
      },
    },
  });

  if (!page || page.collectionId !== collection.id) notFound();

  const displayName =
    page.displayName ?? page.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Dokument';

  const prevPage = currentIndex > 0 ? allPages[currentIndex - 1] : null;
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null;

  function NavArrow({
    href,
    title,
    direction,
  }: {
    href: string | null;
    title: string;
    direction: 'prev' | 'next';
  }): React.JSX.Element {
    const path =
      direction === 'prev'
        ? 'M15.75 19.5 8.25 12l7.5-7.5'
        : 'm8.25 4.5 7.5 7.5-7.5 7.5';
    if (href) {
      return (
        <Link
          href={href}
          className="rounded-lg p-2 text-[#a08060] transition-colors hover:bg-[#f5edd6] hover:text-[#3d2b1f]"
          aria-label={title}
          title={title}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={path} />
          </svg>
        </Link>
      );
    }
    return (
      <span className="cursor-default rounded-lg p-2 text-[#d4c5a9]" aria-disabled="true">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
        </svg>
      </span>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f0e6d0]">
      <header className="shrink-0 border-b border-[#d4c5a9] bg-[#2c1810]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/view/${slug}`}
              className="inline-flex items-center gap-1.5 text-sm text-[#a08060] transition-colors hover:text-[#d4a855]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              {collection.name}
            </Link>
            <span className="text-[#7a6652]">/</span>
            <h1 className="font-serif text-base font-semibold text-[#f5edd6]">{displayName}</h1>
          </div>

          <div className="flex items-center gap-1">
            <NavArrow
              href={prevPage ? `/view/${slug}/${prevPage.id}` : null}
              title={
                prevPage
                  ? (prevPage.displayName ?? prevPage.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Předchozí')
                  : 'Předchozí'
              }
              direction="prev"
            />
            <span className="min-w-[4rem] text-center font-serif text-xs text-[#a08060]">
              {currentIndex + 1} / {allPages.length}
            </span>
            <NavArrow
              href={nextPage ? `/view/${slug}/${nextPage.id}` : null}
              title={
                nextPage
                  ? (nextPage.displayName ?? nextPage.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Další')
                  : 'Další'
              }
              direction="next"
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <div className="w-1/3 shrink-0 self-start overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6]">
          <div className="border-b border-[#d4c5a9] bg-[#ebe0c8] px-5 py-3">
            <h2 className="font-serif text-sm font-semibold text-[#3d2b1f]">Originál</h2>
          </div>
          <div className="bg-[#e8dcc4]">
            <ImageZoom src={page.imageUrl} alt={displayName} />
          </div>
        </div>

        <div className="flex w-2/3 flex-col overflow-y-auto">
          {page.document ? (
            <PublicResultViewer document={page.document} />
          ) : (
            <div className="flex h-full items-center justify-center text-[#a08060]">
              <p className="font-serif text-sm">Dokument zatím nebyl zpracován.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
