'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import HeroCarousel from '@/components/HeroCarousel';

export default function ForgotPasswordPage(): React.JSX.Element {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
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
            <h1 className="font-serif text-2xl font-bold text-[#3d2b1f]">{t('forgotPasswordTitle')}</h1>
            <p className="mt-1 text-sm text-[#7a6652]">{t('forgotPasswordSubtitle')}</p>
          </div>

          {success ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                {t('forgotPasswordEmailSent')}
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 font-serif text-sm font-semibold text-[#8b1a1a] hover:underline"
              >
                {tc('backToLogin')}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-serif text-xs font-medium text-[#5a4a3a]">
                  {t('emailLabel')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSubmit();
                  }}
                  placeholder="vas@email.cz"
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
                disabled={loading || !email}
                className="w-full rounded-lg bg-[#8b1a1a] px-4 py-2.5 font-serif text-sm font-semibold text-[#f5edd6] shadow-md shadow-[#8b1a1a]/20 transition-all hover:bg-[#a52020] disabled:opacity-50"
              >
                {loading ? tc('wait') : t('sendResetLink')}
              </button>

              <p className="text-center text-sm text-[#7a6652]">
                <Link href="/login" className="font-semibold text-[#8b1a1a] hover:underline">
                  {tc('backToLogin')}
                </Link>
              </p>
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
