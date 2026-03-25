'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useRouter, Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import HeroCarousel from '@/components/HeroCarousel';
import LocaleSwitcher from '@/components/LocaleSwitcher';

export default function LoginPage(): React.JSX.Element {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm(): React.JSX.Element {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
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
        setError(data.error ?? t('registrationFailed'));
        setLoading(false);
        return;
      }
      // Redirect to verify-email page
      sessionStorage.setItem('verify-email', email);
      router.push('/verify-email');
      return;
    }

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      // Check if email is unverified
      const checkRes = await fetch('/api/auth/check-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const checkData = (await checkRes.json()) as { verified: boolean };
      if (!checkData.verified) {
        setError('EMAIL_NOT_VERIFIED');
      } else {
        setError(t('wrongCredentials'));
      }
      setLoading(false);
      return;
    }

    // Set NEXT_LOCALE cookie from user preference
    try {
      const localeRes = await fetch('/api/user/locale');
      const { locale: userLocale } = (await localeRes.json()) as { locale: string | null };
      if (userLocale) {
        document.cookie = `NEXT_LOCALE=${userLocale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
      }
    } catch {
      // ignore — cookie will be set on next locale switch
    }
    router.push(callbackUrl);
  };

  const inputClasses =
    'w-full rounded-lg border border-[#d4c5a9] bg-[#f5edd6] px-4 py-2.5 font-serif text-sm text-[#3d2b1f] placeholder:text-[#a08060] outline-none transition-colors focus:border-[#8b1a1a] focus:ring-1 focus:ring-[#8b1a1a]/30';

  return (
    <div className="flex h-screen">
      {/* Left — form */}
      <div className="flex w-full flex-col justify-between bg-[#f0e6d0] px-8 py-8 lg:w-[480px] lg:min-w-[480px]">
        {/* Top — logo */}
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="font-serif text-xl font-bold text-[#3d2b1f]">
              A<span className="text-[#a08060]">i</span>Sedlacek
            </span>
          </Link>
          <LocaleSwitcher />
        </div>

        {/* Center — form */}
        <div className="mx-auto w-full max-w-[340px] space-y-6">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[#3d2b1f]">
              {mode === 'login' ? t('loginTitle') : t('registerTitle')}
            </h1>
            <p className="mt-1 text-sm text-[#7a6652]">
              {mode === 'login' ? t('loginSubtitle') : t('registerSubtitle')}
            </p>
          </div>

          {searchParams.get('verified') === 'true' && (
            <div className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800">
              {t('emailVerifiedSuccess')}
            </div>
          )}
          {searchParams.get('error') === 'invalid-token' && (
            <div className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
              {t('invalidToken')}
            </div>
          )}
          {searchParams.get('error') === 'missing-token' && (
            <div className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
              {t('missingToken')}
            </div>
          )}

          {/* OAuth */}
          <button
            onClick={() => void signIn('google', { callbackUrl })}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#d4c5a9] bg-[#f5edd6] px-4 py-2.5 text-sm font-medium text-[#3d2b1f] transition-colors hover:bg-[#ebe0c8]"
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
            {t('continueWithGoogle')}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#d4c5a9]" />
            <span className="font-serif text-xs text-[#a08060]">{t('or')}</span>
            <div className="h-px flex-1 bg-[#d4c5a9]" />
          </div>

          {/* Credentials */}
          <div className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                  {t('nameLabel')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('nameLabel')}
                  className={inputClasses}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                {t('emailLabel')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className={inputClasses}
              />
            </div>
            <div>
              <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                {t('passwordLabel')}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCredentials();
                  }}
                  placeholder="••••••••"
                  className={inputClasses + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a08060] transition-colors hover:text-[#3d2b1f]"
                  tabIndex={-1}
                >
                  {showPassword ? (
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
                        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    </svg>
                  ) : (
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
                        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {mode === 'login' && (
              <div className="text-right">
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-[#8b1a1a] hover:underline"
                >
                  {t('forgotPassword')}
                </Link>
              </div>
            )}

            {error === 'EMAIL_NOT_VERIFIED' ? (
              <div className="space-y-2 rounded-lg bg-[#8b1a1a]/10 px-3 py-2">
                <p className="text-sm text-[#8b1a1a]">{t('emailNotVerified')}</p>
                <button
                  onClick={() => {
                    sessionStorage.setItem('verify-email', email);
                    router.push('/verify-email');
                  }}
                  className="text-sm font-semibold text-[#8b1a1a] hover:underline"
                >
                  {t('resendVerificationEmail')}
                </button>
              </div>
            ) : error ? (
              <p className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">{error}</p>
            ) : null}

            <button
              onClick={() => void handleCredentials()}
              disabled={loading || !email || !password}
              className="w-full rounded-lg bg-[#8b1a1a] px-4 py-2.5 font-serif text-sm font-semibold text-[#f5edd6] shadow-md shadow-[#8b1a1a]/20 transition-all hover:bg-[#a52020] disabled:opacity-50"
            >
              {loading ? tc('wait') : mode === 'login' ? t('loginButton') : t('registerButton')}
            </button>
          </div>

          {/* Toggle mode */}
          <p className="text-center text-sm text-[#7a6652]">
            {mode === 'login' ? (
              <>
                {t('noAccount')}{' '}
                <button
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="font-semibold text-[#8b1a1a] hover:underline"
                >
                  {t('registerLink')}
                </button>
              </>
            ) : (
              <>
                {t('hasAccount')}{' '}
                <button
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="font-semibold text-[#8b1a1a] hover:underline"
                >
                  {t('loginLink')}
                </button>
              </>
            )}
          </p>
        </div>

        {/* Bottom — back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-serif text-sm text-[#a08060] transition-colors hover:text-[#3d2b1f]"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          {tc('backToHome')}
        </Link>
      </div>

      {/* Right — manuscript carousel */}
      <div className="relative hidden flex-1 lg:block">
        <HeroCarousel />
      </div>
    </div>
  );
}
