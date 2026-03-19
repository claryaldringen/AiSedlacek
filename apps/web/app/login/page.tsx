'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/workspace';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleCredentials = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    if (mode === 'register') {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email, password }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Registrace selhala');
        setLoading(false);
        return;
      }
    }

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(
        mode === 'login' ? 'Nesprávný email nebo heslo' : 'Přihlášení po registraci selhalo',
      );
      setLoading(false);
      return;
    }

    router.push(callbackUrl);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">
            A<span className="text-slate-400">i</span>Sedlacek
          </h1>
          <p className="mt-1 text-sm text-slate-500">Čtečka starých textů</p>
        </div>

        {/* OAuth */}
        <div className="space-y-2">
          <button
            onClick={() => void signIn('google', { callbackUrl })}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Pokračovat přes Google
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">nebo</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Credentials form */}
        <div className="space-y-3">
          {mode === 'register' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jméno (volitelné)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCredentials();
              }}
              placeholder="Heslo"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              tabIndex={-1}
            >
              {showPassword ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={() => void handleCredentials()}
            disabled={loading || !email || !password}
            className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? 'Počkejte…' : mode === 'login' ? 'Přihlásit se' : 'Zaregistrovat se'}
          </button>
        </div>

        {/* Toggle mode */}
        <p className="text-center text-sm text-slate-500">
          {mode === 'login' ? (
            <>
              Nemáte účet?{' '}
              <button
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className="font-medium text-blue-600 hover:underline"
              >
                Zaregistrujte se
              </button>
            </>
          ) : (
            <>
              Máte účet?{' '}
              <button
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className="font-medium text-blue-600 hover:underline"
              >
                Přihlaste se
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
