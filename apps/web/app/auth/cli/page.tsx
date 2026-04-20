'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

function CliAuthContent() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const redirect = searchParams.get('redirect');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleAuthorize() {
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/cli/token', { method: 'POST' });
      if (!res.ok) throw new Error('Token creation failed');
      const { token } = await res.json();

      const url = new URL(redirect!);
      url.searchParams.set('token', token);
      url.searchParams.set('state', state!);
      window.location.href = url.toString();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (!state || !redirect) {
    return <div className="p-8 text-center">Neplatný požadavek.</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-xl font-bold">CLI přístup</h1>
        <p className="mb-6 text-gray-600">
          Aplikace <strong>ais</strong> žádá přístup k vašemu účtu.
        </p>

        {status === 'error' && (
          <p className="mb-4 text-red-600">
            Chyba při autorizaci. Zkuste to znovu.
          </p>
        )}

        <button
          onClick={handleAuthorize}
          disabled={status === 'loading' || status === 'done'}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Autorizuji...' : 'Povolit přístup'}
        </button>
      </div>
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Načítám...</div>}>
      <CliAuthContent />
    </Suspense>
  );
}
