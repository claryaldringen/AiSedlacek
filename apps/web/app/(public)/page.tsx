import Link from 'next/link';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/infrastructure/db';

async function getStats(): Promise<{ pages: number; documents: number; collections: number }> {
  try {
    const [pages, documents, collections] = await Promise.all([
      prisma.page.count(),
      prisma.document.count(),
      prisma.collection.count(),
    ]);
    return { pages, documents, collections };
  } catch {
    return { pages: 0, documents: 0, collections: 0 };
  }
}

export default async function LandingPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (session?.user) redirect('/workspace');

  const stats = await getStats();

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="absolute left-0 right-0 top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-xl font-bold tracking-wide text-white">
            A<span className="text-stone-400">i</span>Sedlacek
          </span>
          <nav className="flex items-center gap-6">
            <a href="#how-it-works" className="text-sm text-stone-300 transition-colors hover:text-white">
              Jak to funguje
            </a>
            <a href="#texts" className="text-sm text-stone-300 transition-colors hover:text-white">
              Jaké texty
            </a>
            <Link
              href="/login"
              className="rounded-lg border border-stone-400/30 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:border-white/50 hover:bg-white/10"
            >
              Přihlásit se
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[85vh] items-center overflow-hidden bg-stone-900">
        {/* Background pattern — subtle parchment texture */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-stone-900 via-stone-800 to-amber-900/40" />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400/80">
              Brána k písemnému dědictví
            </p>
            <h1 className="mt-4 text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              Čtečka starých
              <br />
              <span className="text-amber-200">textů</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-300">
              Nahrajte sken historického rukopisu a získejte přesný přepis, překlad do moderního
              jazyka, historický kontext a slovníček archaických pojmů.
            </p>
            <div className="mt-10 flex items-center gap-4">
              <Link
                href="/login"
                className="rounded-lg bg-amber-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/30 transition-all hover:bg-amber-500 hover:shadow-amber-900/40"
              >
                Začít zdarma
              </Link>
              <a
                href="#how-it-works"
                className="group flex items-center gap-2 rounded-lg px-5 py-3.5 text-sm font-semibold text-stone-300 transition-colors hover:text-white"
              >
                Jak to funguje
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
        </div>

        {/* Decorative side element */}
        <div className="absolute -right-20 top-1/2 hidden -translate-y-1/2 lg:block">
          <div className="h-[500px] w-[400px] rounded-l-3xl border border-stone-700/50 bg-gradient-to-b from-stone-800/50 to-stone-900/50 p-8 shadow-2xl backdrop-blur-sm">
            <div className="flex h-full flex-col justify-between rounded-xl border border-stone-600/30 bg-stone-800/30 p-6">
              <div className="space-y-3">
                <div className="h-2 w-3/4 rounded bg-stone-600/40" />
                <div className="h-2 w-full rounded bg-stone-600/30" />
                <div className="h-2 w-5/6 rounded bg-stone-600/30" />
                <div className="h-2 w-2/3 rounded bg-stone-600/20" />
              </div>
              <div className="space-y-2">
                <p className="font-serif text-xs italic leading-relaxed text-stone-500">
                  „Item Identity Boczek de Kunstatu et de Podiebrad..."
                </p>
                <div className="h-px bg-stone-700/50" />
                <p className="text-xs leading-relaxed text-stone-500">
                  Též jmenovaný Boček z Kunštátu a z Poděbrad...
                </p>
              </div>
              <div className="flex gap-2">
                <span className="rounded bg-amber-900/30 px-2 py-1 text-[10px] text-amber-400/70">
                  stará čeština
                </span>
                <span className="rounded bg-stone-700/50 px-2 py-1 text-[10px] text-stone-400">
                  15. stol.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-3 divide-x divide-stone-200">
          {[
            { value: stats.pages.toLocaleString('cs-CZ'), label: 'Nahraných stránek' },
            { value: stats.documents.toLocaleString('cs-CZ'), label: 'Zpracovaných dokumentů' },
            { value: stats.collections.toLocaleString('cs-CZ'), label: 'Svazků' },
          ].map((stat) => (
            <div key={stat.label} className="px-6 py-10 text-center">
              <p className="text-3xl font-bold tracking-tight text-stone-900">{stat.value}</p>
              <p className="mt-1 text-sm text-stone-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-amber-700">
            Tři kroky
          </p>
          <h2 className="mt-2 text-center text-3xl font-bold text-stone-900">Jak to funguje</h2>
          <div className="mt-16 grid gap-12 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Nahrajte dokument',
                desc: 'Nahrajte sken nebo fotografii historického textu. Podporujeme JPEG, PNG, TIFF i WebP. Můžete i vložit URL z digitálních knihoven.',
                icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5',
              },
              {
                step: '02',
                title: 'AI zpracování',
                desc: 'Claude Vision přečte text z obrázku, přeloží ho do moderního jazyka a doplní historický kontext s glosářem.',
                icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z',
              },
              {
                step: '03',
                title: 'Diskutujte a opravujte',
                desc: 'V integrovaném chatu se můžete modelu zeptat na cokoliv o dokumentu a nechat ho opravit transkripci nebo překlad.',
                icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
              },
            ].map((item) => (
              <div key={item.step}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
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
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-amber-600/60">
                  {item.step}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-stone-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported texts */}
      <section id="texts" className="border-t border-stone-200 bg-stone-50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-amber-700">
            Specializace
          </p>
          <h2 className="mt-2 text-center text-3xl font-bold text-stone-900">Jaké texty zvládáme</h2>
          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: 'Stará čeština',
                desc: 'Bastarda, kurzíva, 14.–16. stol.',
                period: '14.–16. stol.',
              },
              {
                label: 'Historická němčina',
                desc: 'Fraktura, švabach, kancelářské písmo',
                period: '15.–19. stol.',
              },
              {
                label: 'Latina',
                desc: 'Středověké rukopisy i tisky',
                period: '9.–18. stol.',
              },
              {
                label: 'Smíšené texty',
                desc: 'Vícejazyčné dokumenty, glosy',
                period: 'všechna období',
              },
            ].map((item) => (
              <div
                key={item.label}
                className="group rounded-xl border border-stone-200 bg-white p-6 transition-all hover:border-amber-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-base font-semibold text-stone-800">{item.label}</h3>
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500 group-hover:bg-amber-50 group-hover:text-amber-700">
                    {item.period}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About / CTA */}
      <section className="bg-stone-900 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-amber-400/70">
              O projektu
            </p>
            <h2 className="mt-2 text-3xl font-bold text-white">Na počest Augusta Sedláčka</h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-stone-400">
              Projekt je pojmenován po Augustu Sedláčkovi (1843–1926), českém historikovi a
              archiváři, který zasvětil život studiu historických pramenů. Naším cílem je zpřístupnit
              středověké texty moderním čtenářům.
            </p>
            <Link
              href="/login"
              className="mt-10 inline-block rounded-lg bg-amber-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/30 transition-all hover:bg-amber-500"
            >
              Vyzkoušet zdarma
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 bg-stone-950 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="text-lg font-bold tracking-wide text-stone-400">
              A<span className="text-stone-600">i</span>Sedlacek
            </span>
            <p className="text-sm text-stone-500">
              Provozuje{' '}
              <a
                href="https://tyrovsti.cz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-stone-400 underline decoration-stone-600 underline-offset-2 transition-colors hover:text-amber-400 hover:decoration-amber-600"
              >
                Týřovští z.s.
              </a>
            </p>
            <div className="text-xs leading-relaxed text-stone-600">
              <p>IČO: 24090956 &middot; Karla Čapka 1393, Beroun-Město, 266 01 Beroun</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
