import Link from 'next/link';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function LandingPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (session?.user) redirect('/workspace');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-slate-800">
            A<span className="text-slate-400">i</span>Sedlacek
          </span>
          <Link
            href="/login"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            Přihlásit se
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Čtečka starých textů
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          Nahrajte sken historického rukopisu a získejte přesný přepis, překlad do moderního jazyka,
          historický kontext a slovníček archaických pojmů. Vše poháněno umělou inteligencí.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Začít zdarma
          </Link>
          <a
            href="#how-it-works"
            className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Jak to funguje
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-slate-200 bg-white py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900">Jak to funguje</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">1. Nahrajte dokument</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Nahrajte sken nebo fotografii historického textu. Podporujeme JPEG, PNG, TIFF i WebP.
                Můžete i vložit URL z digitálních knihoven.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">2. AI zpracování</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Claude Vision přečte text z obrázku, přeloží ho do moderního jazyka
                a doplní historický kontext s glosářem.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">3. Diskutujte a opravujte</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                V integrovaném chatu se můžete modelu zeptat na cokoliv o dokumentu
                a nechat ho opravit transkripci nebo překlad.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Supported texts */}
      <section className="border-t border-slate-200 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900">Jaké texty zvládáme</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Stará čeština', desc: 'Bastarda, kurzíva, 14.–16. stol.' },
              { label: 'Historická němčina', desc: 'Fraktura, švabach, kancelářské písmo' },
              { label: 'Latina', desc: 'Středověké rukopisy i tisky' },
              { label: 'Smíšené texty', desc: 'Vícejazyčné dokumenty, glosy' },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-800">{item.label}</h3>
                <p className="mt-1 text-xs text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-200 bg-slate-800 py-16">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2 className="text-2xl font-bold text-white">Na počest Augusta Sedláčka</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            Projekt je pojmenován po Augustu Sedláčkovi (1843–1926), českém historikovi a archiváři,
            který zasvětil život studiu historických pramenů. Naším cílem je zpřístupnit
            středověké texty moderním čtenářům.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Vyzkoušet zdarma
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-5xl px-6 text-center text-xs text-slate-400">
          AiSedlacek — OCR + AI překlad historických rukopisů
        </div>
      </footer>
    </div>
  );
}
