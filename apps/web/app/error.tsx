'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0e6d0] px-4">
      <div className="w-full max-w-lg rounded-lg border border-[#c9b99a] bg-[#faf4e8] p-8 text-center shadow-lg">
        <h1 className="mb-4 font-serif text-3xl font-bold text-[#8b1a1a]">Něco se pokazilo</h1>
        <p className="mb-6 font-serif text-[#3d2b1f]">{error.message || 'Došlo k neočekávané chybě.'}</p>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-[#8b1a1a] px-6 py-2 font-serif text-white transition-colors hover:bg-[#6d1515]"
          >
            Zkusit znovu
          </button>
          <a href="/" className="font-serif text-sm text-[#3d2b1f] underline hover:text-[#8b1a1a]">
            Zpět na úvodní stránku
          </a>
        </div>
      </div>
    </div>
  );
}
