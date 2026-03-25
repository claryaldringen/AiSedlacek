'use client';

import { useState, useEffect, Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/infrastructure/api-client';

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent(): React.JSX.Element {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [email, setEmail] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('verify-email');
    if (stored) setEmail(stored);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleResend = async (): Promise<void> => {
    if (!email || sending || countdown > 0) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setMessage(t('emailRecentlySent'));
      } else {
        setMessage(t('verificationEmailSent'));
        setCountdown(60);
      }
    } catch {
      setMessage(t('emailSendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0e6d0] px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* Mail icon */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#8b1a1a]/10">
          <svg
            className="h-8 w-8 text-[#8b1a1a]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
            />
          </svg>
        </div>

        <h1 className="font-serif text-2xl font-bold text-[#3d2b1f]">{t('verifyEmailTitle')}</h1>

        <p className="text-sm text-[#7a6652]">
          {email
            ? t.rich('verifyEmailWithAddress', {
                email,
                strong: (chunks) => <strong className="text-[#3d2b1f]">{chunks}</strong>,
              })
            : t('verifyEmailWithoutAddress')}
        </p>

        {message && (
          <p className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">{message}</p>
        )}

        <button
          onClick={() => void handleResend()}
          disabled={!email || sending || countdown > 0}
          className="rounded-lg border border-[#d4c5a9] bg-[#f5edd6] px-4 py-2.5 font-serif text-sm font-medium text-[#3d2b1f] transition-colors hover:bg-[#ebe0c8] disabled:opacity-50"
        >
          {sending
            ? t('sendingEmail')
            : countdown > 0
              ? t('resendWithCountdown', { countdown })
              : t('resend')}
        </button>

        <Link href="/login" className="block text-sm font-medium text-[#8b1a1a] hover:underline">
          {tc('backToLogin')}
        </Link>
      </div>
    </div>
  );
}
