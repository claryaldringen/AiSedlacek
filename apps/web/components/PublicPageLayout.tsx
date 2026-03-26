import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ImageZoom from '@/components/ImageZoom';
import { PublicResultViewer, type PublicDocument } from '@/components/PublicResultViewer';
import LocaleSwitcher from '@/components/LocaleSwitcher';

export async function PublicPageLayout({
  backHref,
  backLabel,
  title,
  imageUrl,
  document,
  navigation,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  imageUrl: string;
  document: PublicDocument | null;
  navigation?: React.ReactNode;
}): Promise<React.JSX.Element> {
  const t = await getTranslations('view');
  return (
    <div className="flex min-h-screen flex-col bg-[#f0e6d0]">
      <header className="shrink-0 border-b border-[#d4c5a9] bg-[#2c1810]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
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
              {backLabel}
            </Link>
            {backHref !== '/' && <span className="text-[#7a6652]">/</span>}
            <h1 className="font-serif text-base font-semibold text-[#f5edd6]">{title}</h1>
          </div>

          <div className="flex items-center gap-3">
            {navigation && <div className="flex items-center gap-1">{navigation}</div>}
            <LocaleSwitcher variant="dark" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <div className="w-1/3 shrink-0 self-start overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6]">
          <div className="border-b border-[#d4c5a9] bg-[#ebe0c8] px-5 py-3">
            <h2 className="font-serif text-sm font-semibold text-[#3d2b1f]">{t('original')}</h2>
          </div>
          <div className="bg-[#e8dcc4]">
            <ImageZoom src={imageUrl} alt={title} />
          </div>
        </div>

        <div className="flex w-2/3 flex-col overflow-y-auto">
          {document ? (
            <PublicResultViewer document={document} />
          ) : (
            <div className="flex h-full items-center justify-center text-[#a08060]">
              <p className="font-serif text-sm">{t('notProcessed')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
