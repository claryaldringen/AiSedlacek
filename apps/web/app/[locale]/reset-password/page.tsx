'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import HeroCarousel from '@/components/HeroCarousel';
import { apiFetch } from '@/lib/infrastructure/api-client';

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm(): React.JSX.Element {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = (await res.json()) as { error?: string; message?: string };

      if (!res.ok) {
        setError(data.error ?? tc('somethingWentWrong'));
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError(tc('somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  };

  const inputClasses =
    'w-full rounded-lg border border-[#d4c5a9] bg-[#f5edd6] px-4 py-2.5 font-serif text-sm text-[#3d2b1f] placeholder:text-[#a08060] outline-none transition-colors focus:border-[#8b1a1a] focus:ring-1 focus:ring-[#8b1a1a]/30';

  return (
    <div className="flex h-screen">
      {/* Left — form */}
      <div className="flex w-full flex-col justify-between bg-[#f0e6d0] px-8 py-8 lg:w-[480px] lg:min-w-[480px]">
        {/* Top — logo */}
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="font-serif text-xl font-bold text-[#3d2b1f]">
            A<span className="text-[#a08060]">i</span>Sedlacek
          </span>
        </Link>

        {/* Center — form */}
        <div className="mx-auto w-full max-w-[340px] space-y-6">
          <div>
            <h1 className="font-serif text-2xl font-bold text-[#3d2b1f]">
              {t('resetPasswordTitle')}
            </h1>
            <p className="mt-1 text-sm text-[#7a6652]">{t('resetPasswordSubtitle')}</p>
          </div>

          {!token ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-[#8b1a1a]/10 px-4 py-3 text-sm text-[#8b1a1a]">
                {t('missingResetToken')}
              </p>
              <Link
                href="/forgot-password"
                className="inline-flex items-center gap-1.5 font-serif text-sm font-semibold text-[#8b1a1a] hover:underline"
              >
                {t('requestNewLink')}
              </Link>
            </div>
          ) : success ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                {t('passwordChangedSuccess')}
              </p>
              <Link
                href="/login"
                className="inline-block w-full rounded-lg bg-[#8b1a1a] px-4 py-2.5 text-center font-serif text-sm font-semibold text-[#f5edd6] shadow-md shadow-[#8b1a1a]/20 transition-all hover:bg-[#a52020]"
              >
                {t('loginButton')}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                  {t('newPasswordLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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

              <div>
                <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                  {t('confirmPasswordLabel')}
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSubmit();
                  }}
                  placeholder="••••••••"
                  className={inputClasses}
                />
              </div>

              {error && (
                <p className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
                  {error}
                </p>
              )}

              <button
                onClick={() => void handleSubmit()}
                disabled={loading || !password || !confirmPassword}
                className="w-full rounded-lg bg-[#8b1a1a] px-4 py-2.5 font-serif text-sm font-semibold text-[#f5edd6] shadow-md shadow-[#8b1a1a]/20 transition-all hover:bg-[#a52020] disabled:opacity-50"
              >
                {loading ? tc('wait') : t('changePassword')}
              </button>
            </div>
          )}
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
