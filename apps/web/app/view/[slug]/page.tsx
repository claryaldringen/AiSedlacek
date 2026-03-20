import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/infrastructure/db';
import { PublicResultViewer } from '@/components/PublicResultViewer';
import ImageZoom from '@/components/ImageZoom';

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
      title: `${collection.name} — AiSedlacek`,
      description: collection.description || `Veřejná kolekce: ${collection.name}`,
    };
  }

  if (ps.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: ps.targetId },
      select: { displayName: true, filename: true },
    });
    if (!page) return { title: 'Nenalezeno' };
    return { title: `${page.displayName ?? 'Dokument'} — AiSedlacek` };
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

    const doneCount = collection.pages.filter((p) => p.status === 'done').length;

    return (
      <div className="min-h-screen bg-[#f0e6d0]">
        <header className="border-b border-[#d4c5a9] bg-[#2c1810]">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-[#a08060] transition-colors hover:text-[#d4a855]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              AiSedlacek
            </Link>
            <h1 className="mt-3 font-serif text-3xl font-bold text-[#f5edd6]">{collection.name}</h1>
            {collection.description && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#a08060]">
                {collection.description}
              </p>
            )}
            <p className="mt-3 text-xs text-[#7a6652]">
              {doneCount}{' '}
              {doneCount === 1
                ? 'zpracovaná stránka'
                : doneCount < 5
                  ? 'zpracované stránky'
                  : 'zpracovaných stránek'}
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          {collection.pages.length === 0 ? (
            <p className="text-center font-serif text-[#a08060]">
              Kolekce neobsahuje žádné stránky.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {collection.pages.map((page, index) => {
                const displayName =
                  page.displayName ??
                  page.filename.replace(/^[a-f0-9-]+-/, '') ??
                  `Stránka ${index + 1}`;
                return (
                  <Link
                    key={page.id}
                    href={`/view/${slug}/${page.id}`}
                    className="group overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6] transition-all hover:border-[#a08060] hover:shadow-lg"
                  >
                    <div className="aspect-[3/4] overflow-hidden bg-[#e8dcc4]">
                      {(page.thumbnailUrl ?? page.imageUrl) ? (
                        <img
                          src={page.thumbnailUrl ?? page.imageUrl}
                          alt={displayName}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[#d4c5a9]">
                          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate font-serif text-xs font-medium text-[#3d2b1f]">
                        {displayName}
                      </p>
                      {page.status !== 'done' && (
                        <p className="text-[10px] text-[#a08060]">
                          {page.status === 'pending' && 'Čeká na zpracování'}
                          {page.status === 'processing' && 'Zpracovává se…'}
                          {page.status === 'error' && 'Chyba zpracování'}
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
      <div className="flex min-h-screen flex-col bg-[#f0e6d0]">
        <header className="shrink-0 border-b border-[#d4c5a9] bg-[#2c1810]">
          <div className="mx-auto flex max-w-7xl items-center px-6 py-3">
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-[#a08060] transition-colors hover:text-[#d4a855]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
                AiSedlacek
              </Link>
              <h1 className="mt-0.5 font-serif text-base font-semibold text-[#f5edd6]">
                {displayName}
              </h1>
            </div>
          </div>
        </header>

        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <div className="flex w-1/3 flex-col overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6]">
            <div className="shrink-0 border-b border-[#d4c5a9] bg-[#ebe0c8] px-5 py-3">
              <h2 className="font-serif text-sm font-semibold text-[#3d2b1f]">Originál</h2>
            </div>
            <div className="flex-1 overflow-hidden bg-[#e8dcc4]">
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

  notFound();
}
