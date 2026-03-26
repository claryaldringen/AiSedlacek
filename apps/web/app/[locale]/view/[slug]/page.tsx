import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/infrastructure/db';
import { CollectionContextCard } from '@/components/CollectionContextCard';
import { PublicPageLayout } from '@/components/PublicPageLayout';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('view');

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps) return { title: t('notFound') };

  if (ps.targetType === 'collection') {
    const collection = await prisma.collection.findUnique({
      where: { id: ps.targetId },
      select: { name: true, title: true, description: true, abstract: true },
    });
    if (!collection) return { title: t('notFound') };
    const displayTitle = collection.title || collection.name;
    return {
      title: `${displayTitle} — AiSedlacek`,
      description:
        collection.abstract ||
        collection.description ||
        t('publicCollectionTitle', { name: displayTitle }),
    };
  }

  if (ps.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: ps.targetId },
      select: { displayName: true, filename: true },
    });
    if (!page) return { title: t('notFound') };
    return { title: `${page.displayName ?? 'Dokument'} — AiSedlacek` };
  }

  return { title: 'AiSedlacek' };
}

export default async function PublicSlugPage({ params }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;
  const t = await getTranslations('view');

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
              AiSedlacek
            </Link>
            <h1 className="mt-3 font-serif text-3xl font-bold text-[#f5edd6]">
              {collection.title || collection.name}
            </h1>
            {collection.abstract && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#c8b898]">
                {collection.abstract}
              </p>
            )}
            {!collection.abstract && collection.description && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#a08060]">
                {collection.description}
              </p>
            )}
            {/* Metadata badges */}
            {(collection.author ||
              collection.yearFrom ||
              collection.yearTo ||
              collection.librarySignature) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {collection.author && (
                  <span className="inline-flex items-center rounded-full bg-[#3d2b1f] px-2.5 py-0.5 text-xs font-medium text-[#d4a855]">
                    {collection.author}
                  </span>
                )}
                {(collection.yearFrom || collection.yearTo) && (
                  <span className="inline-flex items-center rounded-full bg-[#3d2b1f] px-2.5 py-0.5 text-xs font-medium text-[#d4a855]">
                    {collection.yearFrom && collection.yearTo
                      ? `${collection.yearFrom}–${collection.yearTo}`
                      : collection.yearFrom
                        ? t('yearFrom', { year: collection.yearFrom! })
                        : t('yearTo', { year: collection.yearTo! })}
                  </span>
                )}
                {collection.librarySignature && (
                  <span className="inline-flex items-center rounded-full bg-[#3d2b1f] px-2.5 py-0.5 text-xs font-medium text-[#d4a855]">
                    {collection.librarySignature}
                  </span>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-[#7a6652]">
              {t('processedPages', { count: doneCount })}
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          {collection.context && <CollectionContextCard context={collection.context} />}

          {collection.pages.length === 0 ? (
            <p className="text-center font-serif text-[#a08060]">{t('emptyCollection')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {collection.pages.map((page, index) => {
                const displayName =
                  page.displayName ??
                  page.filename.replace(/^[a-f0-9-]+-/, '') ??
                  t('pageTitle', { n: index + 1 });
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
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[#d4c5a9]">
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
                    <div className="px-3 py-2.5">
                      <p className="truncate font-serif text-xs font-medium text-[#3d2b1f]">
                        {displayName}
                      </p>
                      {page.status !== 'done' && (
                        <p className="text-[10px] text-[#a08060]">
                          {page.status === 'pending' && t('pendingStatus')}
                          {page.status === 'processing' && t('processingStatus')}
                          {page.status === 'error' && t('errorStatus')}
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
        collection: { select: { context: true } },
        document: {
          include: {
            translations: { select: { language: true, text: true } },
            glossary: { select: { term: true, definition: true } },
          },
        },
      },
    });

    if (!page || !page.isPublic) notFound();

    const displayName = page.displayName ?? page.filename.replace(/^[a-f0-9-]+-/, '') ?? t('pageTitle', { n: 1 });

    return (
      <PublicPageLayout
        backHref="/"
        backLabel="AiSedlacek"
        title={displayName}
        imageUrl={page.imageUrl}
        document={page.document}
      />
    );
  }

  notFound();
}
