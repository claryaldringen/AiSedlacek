'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

interface BalanceData {
  balance: number;
}

export function UserMenu(): React.JSX.Element | null {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch balance on mount
  useEffect(() => {
    if (!session?.user) return;
    const fetchBalance = async (): Promise<void> => {
      try {
        const res = await fetch('/api/billing/balance');
        if (res.ok) {
          const data = (await res.json()) as BalanceData;
          setBalance(data.balance);
        }
      } catch {
        // ignore
      }
    };
    void fetchBalance();
  }, [session?.user]);

  if (!session?.user) return null;

  const initials = (session.user.name ?? session.user.email ?? '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  const formattedBalance =
    balance !== null
      ? balance.toLocaleString('cs-CZ') + ' token\u016F'
      : null;

  const displayName = session.user.name ?? session.user.email ?? '';

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-slate-700"
        title={displayName}
      >
        {/* Avatar */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-white">
          {session.user.image ? (
            <img src={session.user.image} alt="" className="h-7 w-7 rounded-full" />
          ) : (
            initials
          )}
        </div>

        {/* Name + balance */}
        <div className="hidden items-center gap-2 sm:flex">
          <span className="max-w-[120px] truncate text-sm font-medium text-slate-200">
            {session.user.name ?? session.user.email}
          </span>
          {formattedBalance && (
            <>
              <span className="text-slate-500">|</span>
              <span className="whitespace-nowrap text-xs text-slate-400">
                {formattedBalance}
              </span>
            </>
          )}
        </div>

        {/* Chevron */}
        <svg
          className="h-3.5 w-3.5 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            {session.user.name && (
              <p className="text-sm font-medium text-slate-800">{session.user.name}</p>
            )}
            <p className="truncate text-xs text-slate-500">{session.user.email}</p>
            {formattedBalance && (
              <p className="mt-1 text-xs font-medium text-slate-600">
                {formattedBalance}
              </p>
            )}
          </div>
          <Link
            href="/workspace/billing"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
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
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
              />
            </svg>
            Dob\u00EDt tokeny
          </Link>
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
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
                d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
              />
            </svg>
            Odhl\u00E1sit se
          </button>
        </div>
      )}
    </div>
  );
}
