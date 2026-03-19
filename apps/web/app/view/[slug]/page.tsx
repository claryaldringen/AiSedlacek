import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/infrastructure/db';
import { PublicResultViewer } from '@/components/PublicResultViewer';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps) return { title: 'Nenalezeno' };

  if (ps.targetType === 'collection') {
    const collection = await prisma.collection.findUnique({
      where: { id: ps.targetId },
      select: { name: true, description: true },
    });
    if (!collection) return { title: 'Nenalezeno' };
    return {
      title: collection.name,
      description: collection.description || `Veřejná kolekce: ${collection.name}`,
    };
  }

  if (ps.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: ps.targetId },
      select: { displayName: true, filename: true },
    });
    if (!page) return { title: 'Nenalezeno' };
    return {
      title: page.displayName ?? 'Dokument',
    };
  }

  return { title: 'AiSedlacek' };
}

export default async function PublicSlugPage({ params }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps) notFound();

  // ---- Collection view ----
  if (ps.targetType === 'collection') {
    const collection = await prisma.collection.findUnique({
      where: { id: ps.targetId },
      include: {
        pages: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            displayName: true,
            filename: true,
            thumbnailUrl: true,
            imageUrl: true,
            status: true,
            order: true,
          },
        },
      },
    });

    if (!collection || !collection.isPublic) notFound();

    return (
      <div className="min-h-screen bg-stone-50">
        {/* Header */}
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-4">
            <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">
              ← AiSedlacek
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-stone-900">{collection.name}</h1>
            {collection.description && (
              <p className="mt-1 text-sm text-stone-500">{collection.description}</p>
            )}
          </div>
        </header>

        {/* Page thumbnails grid */}
        <main className="mx-auto max-w-5xl px-6 py-8">
          {collection.pages.length === 0 ? (
            <p className="text-center text-stone-400">Kolekce neobsahuje žádné stránky.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {collection.pages.map((page, index) => {
                const displayName =
                  page.displayName ??
                  page.filename.replace(/^[a-f0-9-]+-/, '') ??
                  `Stránka ${index + 1}`;
                return (
                  <Link
                    key={page.id}
                    href={`/view/${slug}/${page.id}`}
                    className="group flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="aspect-[3/4] overflow-hidden bg-stone-100">
                      {(page.thumbnailUrl ?? page.imageUrl) ? (
                        <img
                          src={page.thumbnailUrl ?? page.imageUrl}
                          alt={displayName}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-stone-300">
                          <svg
                            className="h-10 w-10"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium text-stone-700">{displayName}</p>
                      {page.status !== 'done' && (
                        <p className="text-xs text-stone-400">
                          {page.status === 'pending' && 'Čeká'}
                          {page.status === 'processing' && 'Zpracovává se…'}
                          {page.status === 'error' && 'Chyba'}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  // ---- Single page view ----
  if (ps.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: ps.targetId },
      include: {
        document: {
          include: {
            translations: { select: { language: true, text: true } },
            glossary: { select: { term: true, definition: true } },
          },
        },
      },
    });

    if (!page || !page.isPublic) notFound();

    const displayName = page.displayName ?? page.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Dokument';

    return (
      <div className="flex min-h-screen flex-col bg-stone-50">
        {/* Header */}
        <header className="shrink-0 border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div>
              <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">
                ← AiSedlacek
              </Link>
              <h1 className="mt-0.5 text-base font-semibold text-stone-900">{displayName}</h1>
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

  notFound();
}
