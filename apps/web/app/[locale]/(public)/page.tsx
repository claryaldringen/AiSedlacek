import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/infrastructure/db';
import HeroCarousel from '@/components/HeroCarousel';
import AnimatedCounter from '@/components/AnimatedCounter';

async function getStats(): Promise<{
  pages: number;
  documents: number;
  collections: number;
  languages: number;
}> {
  try {
    const [pages, documents, collections, langs] = await Promise.all([
      prisma.page.count(),
      prisma.document.count(),
      prisma.collection.count(),
      prisma.document.findMany({
        select: { detectedLanguage: true },
        distinct: ['detectedLanguage'],
      }),
    ]);
    return { pages, documents, collections, languages: langs.length };
  } catch (e) {
    console.error('getStats error:', e);
    return { pages: 0, documents: 0, collections: 0, languages: 0 };
  }
}

async function getPublicCollections(): Promise<
  {
    id: string;
    name: string;
    slug: string | null;
    context: string | null;
    pages: { imageUrl: string }[];
    _count: { pages: number };
  }[]
> {
  try {
    const collections = await prisma.collection.findMany({
      where: { isPublic: true },
      select: {
        id: true,
        name: true,
        slug: true,
        context: true,
        pages: {
          where: { status: 'done', document: { isNot: null } },
          select: { imageUrl: true },
          take: 1,
        },
        _count: { select: { pages: true } },
      },
    });
    return collections.filter((c) => c.pages.length > 0);
  } catch (e) {
    console.error('getPublicCollections error:', e);
    return [];
  }
}

export default async function LandingPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (session?.user) redirect('/workspace');

  const t = await getTranslations('landing');

  const [stats, collections] = await Promise.all([getStats(), getPublicCollections()]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'AiSedlacek',
    description: 'Čtečka starých textů — přepis a překlad historických rukopisů pomocí AI',
    url: 'https://aisedlacek.cz',
    applicationCategory: 'UtilityApplication',
    operatingSystem: 'Web',
    creator: {
      '@type': 'Organization',
      name: 'Týřovští z.s.',
    },
  };

  return (
    <div className="min-h-screen bg-[#f0e6d0]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Header */}
      <header className="absolute left-0 right-0 top-0 z-10 bg-[#2c1810]/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="font-serif text-xl font-bold tracking-wide text-white">
            A<span className="text-white/60">i</span>Sedlacek
          </span>
          <nav className="flex items-center gap-6">
            <a
              href="#how-it-works"
              className="text-sm text-white/70 transition-colors hover:text-white"
            >
              {t('navHowItWorks')}
            </a>
            <a
              href="#texts"
              className="text-sm text-white/70 transition-colors hover:text-white"
            >
              {t('navTexts')}
            </a>
            <Link
              href="/login"
              className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/60 hover:bg-white/10"
            >
              {t('navLogin')}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[66vh] items-center overflow-hidden bg-[#2c1810]">
        <HeroCarousel />

        <div className="relative z-[1] mx-auto max-w-6xl px-6">
          <p className="font-serif text-sm font-medium uppercase tracking-[0.2em] text-white/80">
            {t('heroTagline')}
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl font-bold leading-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
            {t('heroHeading')}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/90 drop-shadow">
            {t('heroBody')}
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-[#8b1a1a] px-7 py-3 text-sm font-semibold text-[#f5edd6] shadow-lg shadow-black/30 transition-all hover:bg-[#a52020]"
            >
              {t('heroCta')}
            </Link>
            <a
              href="#how-it-works"
              className="group flex items-center gap-2 px-4 py-3 text-sm font-medium text-[#d4c5a9]/70 transition-colors hover:text-[#f5edd6]"
            >
              {t('heroHowItWorks')}
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-y-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section className="border-b border-[#d4c5a9] bg-[#f5edd6]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-[#d4c5a9] sm:grid-cols-4">
          {[
            {
              value: stats.pages,
              label: t('statPages'),
              icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
            },
            {
              value: stats.documents,
              label: t('statDocuments'),
              icon: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.745 3.745 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z',
            },
            {
              value: stats.collections,
              label: t('statCollections'),
              icon: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
            },
            {
              value: stats.languages,
              label: t('statLanguages'),
              icon: 'm10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802',
            },
          ].map((stat) => (
            <div key={stat.label} className="px-6 py-10 text-center">
              <svg
                className="mx-auto h-10 w-10 text-[#8b1a1a]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
              </svg>
              <p className="mt-3 font-serif text-3xl font-bold tracking-tight text-[#3d2b1f]">
                <AnimatedCounter value={stat.value} />
              </p>
              <p className="mt-1 text-sm text-[#7a6652]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Samples */}
      {collections.length > 0 && (
        <section className="bg-[#f0e6d0] py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center font-serif text-3xl font-bold text-[#3d2b1f]">{t('samplesHeading')}</h2>
            <div
              className={`mt-14 grid gap-8 ${collections.length === 1 ? 'mx-auto max-w-sm' : collections.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
            >
              {collections.map((col) => {
                const contextLines = (col.context ?? '')
                  .split('\n')
                  .filter(
                    (l) =>
                      l.trim() &&
                      !l.startsWith('#') &&
                      !l.startsWith('|') &&
                      !l.startsWith('---') &&
                      !l.startsWith('- '),
                  );
                const perex =
                  contextLines
                    .find((l) => l.length > 40)
                    ?.replace(/\*\*/g, '')
                    .trim() ?? '';

                const href = col.slug ? `/view/${col.slug}` : '#';

                return (
                  <Link
                    key={col.id}
                    href={href}
                    className="group overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6] transition-all hover:border-[#a08060] hover:shadow-lg"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-[#e8dcc4]">
                      <img
                        src={col.pages[0]?.imageUrl}
                        alt={col.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-5">
                      <h3 className="font-serif text-lg font-semibold text-[#3d2b1f]">
                        {col.name}
                      </h3>
                      <p className="mt-1 text-xs text-[#a08060]">
                        {t('samplePages', { count: col._count.pages })}
                      </p>
                      {perex && (
                        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#7a6652]">
                          {perex}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section id="how-it-works" className="bg-[#f0e6d0] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center font-serif text-sm font-semibold uppercase tracking-[0.15em] text-[#8b1a1a]">
            {t('howItWorksLabel')}
          </p>
          <h2 className="mt-2 text-center font-serif text-3xl font-bold text-[#3d2b1f]">
            {t('howItWorksHeading')}
          </h2>
          <div className="mt-16 grid gap-12 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: t('step01Title'),
                desc: t('step01Desc'),
                icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5',
              },
              {
                step: '02',
                title: t('step02Title'),
                desc: t('step02Desc'),
                icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z',
              },
              {
                step: '03',
                title: t('step03Title'),
                desc: t('step03Desc'),
                icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
              },
            ].map((item) => (
              <div key={item.step}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#8b1a1a]/10 text-[#8b1a1a]">
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <p className="mt-4 font-serif text-xs font-bold uppercase tracking-widest text-[#8b1a1a]/50">
                  {item.step}
                </p>
                <h3 className="mt-1 font-serif text-lg font-semibold text-[#3d2b1f]">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#7a6652]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported texts */}
      <section id="texts" className="border-t border-[#d4c5a9] bg-[#f5edd6] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center font-serif text-sm font-semibold uppercase tracking-[0.15em] text-[#8b1a1a]">
            {t('textsLabel')}
          </p>
          <h2 className="mt-2 text-center font-serif text-3xl font-bold text-[#3d2b1f]">
            {t('textsHeading')}
          </h2>
          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: t('oldCzechLabel'),
                desc: t('oldCzechDesc'),
                period: t('oldCzechPeriod'),
              },
              {
                label: t('historicalGermanLabel'),
                desc: t('historicalGermanDesc'),
                period: t('historicalGermanPeriod'),
              },
              {
                label: t('latinLabel'),
                desc: t('latinDesc'),
                period: t('latinPeriod'),
              },
              {
                label: t('mixedTextsLabel'),
                desc: t('mixedTextsDesc'),
                period: t('mixedTextsPeriod'),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="group rounded-xl border border-[#d4c5a9] bg-[#f0e6d0] p-6 transition-all hover:border-[#a08060] hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-serif text-base font-semibold text-[#3d2b1f]">
                    {item.label}
                  </h3>
                  <span className="rounded bg-[#e8dcc4] px-2 py-0.5 text-[10px] font-medium text-[#7a6652] group-hover:bg-[#8b1a1a]/10 group-hover:text-[#8b1a1a]">
                    {item.period}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#7a6652]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About / CTA */}
      <section className="bg-[#2c1810] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-serif text-sm font-semibold uppercase tracking-[0.15em] text-[#d4a855]/70">
              {t('aboutLabel')}
            </p>
            <h2 className="mt-2 font-serif text-3xl font-bold text-[#f5edd6]">
              {t('aboutHeading')}
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#a08060]">
              {t('aboutBody')}
            </p>
            <Link
              href="/login"
              className="mt-10 inline-block rounded-lg bg-[#8b1a1a] px-8 py-3.5 font-serif text-sm font-semibold text-[#f5edd6] shadow-lg shadow-black/30 transition-all hover:bg-[#a52020]"
            >
              {t('aboutCta')}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#3d2b1f] bg-[#1e110a] py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="font-serif text-lg font-bold tracking-wide text-[#a08060]">
              A<span className="text-[#6b5440]">i</span>Sedlacek
            </span>
            <p className="text-sm text-[#7a6652]">
              {t('footerOperatedBy')}{' '}
              <a
                href="https://tyrovsti.cz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#a08060] underline decoration-[#6b5440] underline-offset-2 transition-colors hover:text-[#d4a855] hover:decoration-[#d4a855]"
              >
                Týřovští z.s.
              </a>
            </p>
            <div className="text-xs leading-relaxed text-[#6b5440]">
              <p>{t('footerIco')}</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
