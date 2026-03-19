import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/infrastructure/db';
import { PublicResultViewer } from '@/components/PublicResultViewer';

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

  return {
    title: page.displayName ?? 'Dokument',
  };
}

export default async function PublicCollectionPageView({
  params,
}: Props): Promise<React.JSX.Element> {
  const { slug, pageId } = await params;

  // Verify the slug points to a collection
  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps || ps.targetType !== 'collection') notFound();

  // Verify collection is public
  const collection = await prisma.collection.findUnique({
    where: { id: ps.targetId },
    select: { id: true, name: true, isPublic: true },
  });
  if (!collection || !collection.isPublic) notFound();

  // Fetch all pages in the collection (for prev/next navigation)
  const allPages = await prisma.page.findMany({
    where: { collectionId: collection.id },
    orderBy: { order: 'asc' },
    select: { id: true, displayName: true, filename: true, order: true },
  });

  // Find the current page index
  const currentIndex = allPages.findIndex((p) => p.id === pageId);
  if (currentIndex === -1) notFound();

  // Fetch the current page with document
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

  const displayName = page.displayName ?? page.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Dokument';

  const prevPage = currentIndex > 0 ? allPages[currentIndex - 1] : null;
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null;

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* Header */}
      <header className="shrink-0 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href={`/view/${slug}`} className="text-sm text-stone-500 hover:text-stone-700">
              ← {collection.name}
            </Link>
            <span className="text-stone-300">/</span>
            <h1 className="text-base font-semibold text-stone-900">{displayName}</h1>
          </div>

          {/* Prev / Next navigation */}
          <div className="flex items-center gap-1">
            {prevPage ? (
              <Link
                href={`/view/${slug}/${prevPage.id}`}
                className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
                aria-label="Předchozí stránka"
                title={
                  prevPage.displayName ??
                  prevPage.filename.replace(/^[a-f0-9-]+-/, '') ??
                  'Předchozí'
                }
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 19.5 8.25 12l7.5-7.5"
                  />
                </svg>
              </Link>
            ) : (
              <span className="rounded p-1.5 text-stone-300 cursor-default" aria-disabled="true">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 19.5 8.25 12l7.5-7.5"
                  />
                </svg>
              </span>
            )}
            <span className="text-xs text-stone-400">
              {currentIndex + 1} / {allPages.length}
            </span>
            {nextPage ? (
              <Link
                href={`/view/${slug}/${nextPage.id}`}
                className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
                aria-label="Další stránka"
                title={
                  nextPage.displayName ?? nextPage.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Další'
                }
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </Link>
            ) : (
              <span className="rounded p-1.5 text-stone-300 cursor-default" aria-disabled="true">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Content: image left (1/3), results right (2/3) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: original image */}
        <div className="flex w-1/3 flex-col border-r border-stone-200 bg-stone-100">
          <div className="shrink-0 border-b border-stone-200 bg-stone-50 px-4 py-2">
            <span className="text-xs font-medium text-stone-500">Originál</span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <img src={page.imageUrl} alt={displayName} className="w-full rounded shadow-sm" />
          </div>
        </div>

        {/* Right: result viewer */}
        <div className="flex w-2/3 flex-col overflow-y-auto">
          {page.document ? (
            <PublicResultViewer document={page.document} />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-400">
              <p className="text-sm">Dokument zatím nebyl zpracován.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
