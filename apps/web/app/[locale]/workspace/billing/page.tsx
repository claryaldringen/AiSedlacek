'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/infrastructure/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenTransaction {
  id: string;
  type: 'topup_stripe' | 'topup_bank' | 'consumption' | 'refund';
  amount: number;
  amountCzk: number | null;
  description: string;
  referenceId: string | null;
  createdAt: string;
}

interface BalanceResponse {
  balance: number;
  variableSymbol: number;
  tokensPer100Czk: number;
  fioEnabled: boolean;
  transactions: TokenTransaction[];
}

interface CheckoutResponse {
  url: string;
}

interface FioCheckResponse {
  credited: number;
  balance: number;
  error?: string;
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Preset amounts
// ---------------------------------------------------------------------------

const PRESET_AMOUNTS = [200, 500, 1000, 2000];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BillingPage(): React.JSX.Element {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent(): React.JSX.Element {
  const t = useTranslations('billing');
  const searchParams = useSearchParams();

  // Data state
  const [balance, setBalance] = useState<number | null>(null);
  const [variableSymbol, setVariableSymbol] = useState<number | null>(null);
  const [tokensPer100Czk, setTokensPer100Czk] = useState<number>(0);
  const [fioEnabled, setFioEnabled] = useState(false);
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Stripe state
  const [selectedAmount, setSelectedAmount] = useState<number | null>(200);
  const [customAmount, setCustomAmount] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // FIO state
  const [fioAmount, setFioAmount] = useState('100');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [fioChecking, setFioChecking] = useState(false);
  const [fioResult, setFioResult] = useState<{ credited: number; balance: number } | null>(null);
  const [fioCountdown, setFioCountdown] = useState(0);

  // Success/cancel banner
  const [banner, setBanner] = useState<{ type: 'success' | 'cancelled'; message: string } | null>(
    null,
  );

  // ---------------------------------------------------------------------------
  // Load balance data
  // ---------------------------------------------------------------------------

  const loadBalance = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch('/api/billing/balance');
      if (!res.ok) return;
      const data = (await res.json()) as BalanceResponse;
      setBalance(data.balance);
      setVariableSymbol(data.variableSymbol);
      setTokensPer100Czk(data.tokensPer100Czk);
      setFioEnabled(data.fioEnabled);
      setTransactions(data.transactions);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  // Check for Stripe redirect banners
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setBanner({
        type: 'success',
        message: t('paymentSuccess'),
      });
      // Refresh balance after a short delay (webhook needs time)
      const timer = setTimeout(() => void loadBalance(), 3000);
      return () => clearTimeout(timer);
    }
    if (searchParams.get('cancelled') === 'true') {
      setBanner({ type: 'cancelled', message: t('paymentCancelled') });
    }
  }, [searchParams, loadBalance, t]);

  // ---------------------------------------------------------------------------
  // QR code generation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!variableSymbol) return;
    const amount = parseInt(fioAmount) || 0;
    if (amount <= 0) {
      setQrDataUrl(null);
      return;
    }

    const spayd = [
      'SPD*1.0',
      'ACC:CZ3920100000002803462929+FIOBCZPP',
      `AM:${amount}.00`,
      'CC:CZK',
      `X-VS:${variableSymbol}`,
      'MSG:Dobít tokeny',
    ].join('*');

    const controller = new AbortController();
    void apiFetch('/api/billing/qr?' + new URLSearchParams({ data: spayd }), {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`QR API: ${r.status}`);
        return r.json();
      })
      .then((d: { url: string }) => setQrDataUrl(d.url))
      .catch(() => setQrDataUrl(null));
    return () => controller.abort();
  }, [variableSymbol, fioAmount]);

  // ---------------------------------------------------------------------------
  // FIO countdown timer
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (fioCountdown <= 0) return;
    const timer = setInterval(() => {
      setFioCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [fioCountdown]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const effectiveAmount = selectedAmount ?? (parseInt(customAmount) || 0);

  const handleCheckout = async (): Promise<void> => {
    if (effectiveAmount < 100) return;
    setCheckoutLoading(true);
    try {
      const res = await apiFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCzk: effectiveAmount }),
      });
      const data = (await res.json()) as CheckoutResponse & { error?: string };
      if (!res.ok) {
        setBanner({ type: 'cancelled', message: data.error ?? t('checkoutError') });
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setBanner({ type: 'cancelled', message: t('serverError') });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleFioCheck = async (): Promise<void> => {
    setFioChecking(true);
    setFioResult(null);
    try {
      const res = await apiFetch('/api/billing/fio-check', { method: 'POST' });
      const data = (await res.json()) as FioCheckResponse;

      if (res.status === 429 && data.retryAfterSeconds) {
        setFioCountdown(data.retryAfterSeconds);
        return;
      }
      if (!res.ok) {
        setBanner({ type: 'cancelled', message: data.error ?? t('verificationError') });
        return;
      }

      setFioResult({ credited: data.credited, balance: data.balance });
      setBalance(data.balance);
      // Reload transactions
      void loadBalance();
    } catch {
      setBanner({ type: 'cancelled', message: t('serverError') });
    } finally {
      setFioChecking(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatTokens = (n: number): string => n.toLocaleString('cs-CZ');

  const formatTokensCompact = (n: number): string => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return n.toString();
  };

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const typeLabel = (type: TokenTransaction['type']): string => {
    switch (type) {
      case 'topup_stripe':
        return t('typeCard');
      case 'topup_bank':
        return t('typeTransfer');
      case 'consumption':
        return t('typeConsumption');
      case 'refund':
        return t('typeRefund');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header bar */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href="/workspace"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
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
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
            {t('back')}
          </Link>
          <h1 className="text-lg font-semibold text-slate-800">{t('title')}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {/* Banner */}
        {banner && (
          <div
            className={[
              'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm',
              banner.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-amber-200 bg-amber-50 text-amber-700',
            ].join(' ')}
          >
            {banner.type === 'success' ? (
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
            )}
            <span>{banner.message}</span>
            <button
              onClick={() => setBanner(null)}
              className="ml-auto text-current opacity-50 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        )}

        {/* Balance card */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-5">
            <p className="mb-1 text-sm font-medium text-slate-500">{t('currentBalance')}</p>
            {loading ? (
              <div className="h-9 w-48 animate-pulse rounded bg-slate-100" />
            ) : (
              <>
                <p className="text-3xl font-bold tabular-nums text-slate-800">
                  {formatTokens(balance ?? 0)}{' '}
                  <span className="text-lg font-normal text-slate-400">{t('tokens')}</span>
                </p>
                {tokensPer100Czk > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {t('tokensPerPrice', { tokens: formatTokensCompact(tokensPer100Czk) })}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stripe section */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <svg
                className="h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
                />
              </svg>
              {t('cardPayment')}
            </h2>
          </div>
          <div className="px-5 py-4">
            {/* Preset amounts */}
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount('');
                  }}
                  className={[
                    'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                    selectedAmount === amount
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  ].join(' ')}
                >
                  {amount} {t('currency')}
                  {tokensPer100Czk > 0 && (
                    <span className="ml-1 text-xs opacity-60">
                      ({formatTokensCompact(Math.floor((amount / 100) * tokensPer100Czk))} t.)
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="mb-4 flex items-center gap-2">
              <input
                type="number"
                min={100}
                max={10000}
                placeholder={t('customAmount')}
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                }}
                className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
              <span className="text-sm text-slate-400">{t('currency')}</span>
            </div>

            {/* Pay button */}
            <button
              onClick={() => void handleCheckout()}
              disabled={checkoutLoading || effectiveAmount < 100}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkoutLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  {t('redirecting')}
                </>
              ) : (
                <>
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
                      d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
                    />
                  </svg>
                  {effectiveAmount >= 100
                    ? t('payByCard', {
                        amount: effectiveAmount,
                        tokens: formatTokensCompact(
                          Math.floor((effectiveAmount / 100) * tokensPer100Czk),
                        ),
                      })
                    : t('cardPayment')}
                </>
              )}
            </button>
          </div>
        </div>

        {/* FIO bank transfer section */}
        {fioEnabled && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <svg
                  className="h-4 w-4 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z"
                  />
                </svg>
                {t('bankTransfer')}
              </h2>
            </div>
            <div className="px-5 py-4">
              <div className="flex flex-col gap-6 sm:flex-row">
                {/* QR code */}
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor="fio-amount" className="text-sm text-slate-500">
                      {t('amount')}
                    </label>
                    <input
                      id="fio-amount"
                      type="number"
                      min={1}
                      value={fioAmount}
                      onChange={(e) => setFioAmount(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    />
                    <span className="text-sm text-slate-400">{t('currency')}</span>
                  </div>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={t('qrPayment')}
                      className="h-[200px] w-[200px] rounded-lg border border-slate-100"
                    />
                  ) : (
                    <div className="flex h-[200px] w-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
                      {t('enterAmount')}
                    </div>
                  )}
                </div>

                {/* Account details */}
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                      {t('accountNumber')}
                    </p>
                    <p className="mt-0.5 font-mono text-sm text-slate-700">2803462929/2010</p>
                  </div>
                  {variableSymbol && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                        {t('variableSymbol')}
                      </p>
                      <p className="mt-0.5 font-mono text-lg font-semibold text-slate-800">
                        {variableSymbol}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-slate-400">{t('bankInstructions')}</p>

                  {/* Verify button */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void handleFioCheck()}
                      disabled={fioChecking || fioCountdown > 0}
                      className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {fioChecking ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          {t('verifying')}
                        </>
                      ) : fioCountdown > 0 ? (
                        <>{t('verifyWithCountdown', { countdown: fioCountdown })}</>
                      ) : (
                        <>
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
                              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                            />
                          </svg>
                          {t('verifyPayment')}
                        </>
                      )}
                    </button>

                    {/* FIO result */}
                    {fioResult && (
                      <span className="text-sm">
                        {fioResult.credited > 0 ? (
                          <span className="text-green-600">
                            {t('paymentsCredited', {
                              credited: fioResult.credited,
                              balance: formatTokens(fioResult.balance),
                            })}
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            {t('noNewPayments', { balance: formatTokens(fioResult.balance) })}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <svg
                className="h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              {t('transactionHistory')}
            </h2>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <svg
                  className="h-5 w-5 animate-spin text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
            ) : transactions.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">
                {t('noTransactions')}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-2">{t('columnDate')}</th>
                    <th className="px-5 py-2">{t('columnType')}</th>
                    <th className="px-5 py-2 text-right">{t('columnTokens')}</th>
                    <th className="px-5 py-2">{t('columnDescription')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-2 text-sm text-slate-500">
                        {formatDate(tx.createdAt)}
                      </td>
                      <td className="px-5 py-2">
                        <span
                          className={[
                            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                            tx.amount > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600',
                          ].join(' ')}
                        >
                          {typeLabel(tx.type)}
                        </span>
                      </td>
                      <td
                        className={[
                          'whitespace-nowrap px-5 py-2 text-right text-sm font-medium tabular-nums',
                          tx.amount > 0 ? 'text-green-600' : 'text-red-500',
                        ].join(' ')}
                      >
                        {tx.amount > 0 ? '+' : ''}
                        {formatTokens(tx.amount)}
                      </td>
                      <td className="px-5 py-2 text-sm text-slate-500">{tx.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
