import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';
import { prisma } from '@/lib/infrastructure/db';
import { PublicPageLayout } from '@/components/PublicPageLayout';
import { NavArrow } from '@/components/NavArrow';

type Props = { params: Promise<{ slug: string; pageId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, pageId } = await params;
  const t = await getTranslations('view');

  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps || ps.targetType !== 'collection') return { title: t('notFound') };

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { displayName: true, filename: true, collectionId: true },
  });
  if (!page || page.collectionId !== ps.targetId) return { title: t('notFound') };

  return { title: `${page.displayName ?? 'Dokument'} — AiSedlacek` };
}

export default async function PublicCollectionPageView({
  params,
}: Props): Promise<React.JSX.Element> {
  const { slug, pageId } = await params;
  const t = await getTranslations('common');

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

  const displayName = page.displayName ?? page.filename.replace(/^[a-f0-9-]+-/, '') ?? 'Dokument';

  const prevPage = currentIndex > 0 ? allPages[currentIndex - 1] : null;
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null;

  // Only show document if it has a translation for the current locale
  const locale = await getLocale();
  const hasLocaleTranslation = page.document?.translations.some((tr) => tr.language === locale);
  const documentForLocale = hasLocaleTranslation ? page.document : null;

  return (
    <PublicPageLayout
      backHref={`/view/${slug}`}
      backLabel={collection.name}
      title={displayName}
      imageUrl={page.imageUrl}
      document={documentForLocale}
      navigation={
        <>
          <NavArrow
            href={prevPage ? `/view/${slug}/${prevPage.id}` : null}
            title={
              prevPage
                ? (prevPage.displayName ??
                  prevPage.filename.replace(/^[a-f0-9-]+-/, '') ??
                  t('previous'))
                : t('previous')
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
                ? (nextPage.displayName ??
                  nextPage.filename.replace(/^[a-f0-9-]+-/, '') ??
                  t('next'))
                : t('next')
            }
            direction="next"
          />
        </>
      }
    />
  );
}
