'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { buildCliCallbackUrl, parseCliRedirect, parseCodeChallenge } from './redirect';

function CliAuthContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const redirect = searchParams.get('redirect');
  // Jen http: na loopback s explicitním portem a cestou /callback (SEC-5).
  const redirectUrl = parseCliRedirect(redirect);
  // CLI ≥ 0.3.0 posílá PKCE výzvu – na loopback pak jde jen jednorázový kód, token
  // si CLI vyzvedne POSTem a v URL ani v historii prohlížeče nikdy není. Starší CLI
  // (bez výzvy) dostane token postaru v URL, aby dál fungovalo.
  const pkce = parseCodeChallenge(
    searchParams.get('code_challenge'),
    searchParams.get('code_challenge_method'),
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleAuthorize(): Promise<void> {
    // Kód/token se vydává až po validaci – na neověřenou adresu se nikdy nepřesměruje.
    if (!state || !redirectUrl || pkce.kind === 'invalid') return;
    setStatus('loading');
    try {
      let target: string;
      if (pkce.kind === 'pkce') {
        const res = await fetch('/api/auth/cli/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codeChallenge: pkce.challenge }),
        });
        if (!res.ok) throw new Error('Code creation failed');
        const { code } = (await res.json()) as { code: string };
        target = buildCliCallbackUrl(redirectUrl, { code }, state);
      } else {
        const res = await fetch('/api/auth/cli/token', { method: 'POST' });
        if (!res.ok) throw new Error('Token creation failed');
        const { token } = (await res.json()) as { token: string };
        target = buildCliCallbackUrl(redirectUrl, { token }, state);
      }
      // U nového CLI je v adrese callbacku (a tedy i v historii prohlížeče) jen
      // jednorázový, krátce platný kód, bez PKCE ověřovače z CLI nepoužitelný.
      window.location.href = target;
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (!state || !redirect || pkce.kind === 'invalid') {
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

        {pkce.kind === 'legacy' && (
          <p className="mb-4 rounded bg-amber-50 p-2 text-sm text-amber-800">
            Používáte starší verzi CLI, která přebírá token přes adresu v prohlížeči. Po přihlášení
            ji prosím aktualizujte: <code>npm i -g ai-sedlacek-cli</code>
          </p>
        )}

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
