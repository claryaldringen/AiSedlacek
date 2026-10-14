'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { buildCliCallbackUrl, parseCliRedirect } from './redirect';

function CliAuthContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const redirect = searchParams.get('redirect');
  // Jen http: na loopback s explicitním portem a cestou /callback (SEC-5).
  const redirectUrl = parseCliRedirect(redirect);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleAuthorize(): Promise<void> {
    // Token se vydává až po validaci – na neověřenou adresu se nikdy nepřesměruje.
    if (!state || !redirectUrl) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/cli/token', { method: 'POST' });
      if (!res.ok) throw new Error('Token creation failed');
      const { token } = await res.json();

      window.location.href = buildCliCallbackUrl(redirectUrl, token, state);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (!state || !redirect) {
    return <div className="p-8 text-center">Neplatný požadavek.</div>;
  }

  if (!redirectUrl) {
    return (
      <div className="p-8 text-center text-red-600">
        Neplatný redirect – povolena je pouze adresa http://127.0.0.1:&lt;port&gt;/callback (nebo
        localhost) na tomto počítači.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-xl font-bold">CLI přístup</h1>
        <p className="mb-4 text-gray-600">
          Aplikace <strong>ais</strong> žádá přístup k vašemu účtu.
        </p>
        <p className="mb-6 text-sm text-gray-600">
          Přístupový token bude předán programu na tomto počítači na adrese{' '}
          <strong>{redirectUrl.host}</strong>. Pokud jste právě nespustili <code>ais login</code>,
          přístup nepovolujte.
        </p>

        {status === 'error' && (
          <p className="mb-4 text-red-600">Chyba při autorizaci. Zkuste to znovu.</p>
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

export default function CliAuthPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="p-8 text-center">Načítám...</div>}>
      <CliAuthContent />
    </Suspense>
  );
}
