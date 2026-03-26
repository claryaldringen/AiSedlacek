'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/infrastructure/api-client';
import LocaleSwitcher from './LocaleSwitcher';

export interface Collection {
  id: string;
  name: string;
  description: string;
  context: string;
  contextUrls: string[];
  createdAt: string;
  isPublic: boolean;
  slug: string | null;
  _count: { pages: number };
  processableCount: number;
  stats: {
    done: number;
    pending: number;
    error: number;
    processing: number;
    blank: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  title?: string | null;
  author?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  librarySignature?: string | null;
  abstract?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  type: 'home' | 'public' | 'shared';
  ownerId: string | null;
  inviteCode: string | null;
  createdAt: string;
  _count: { items: number; members: number };
  owner: { id: string; name: string | null; email: string | null } | null;
}

interface BalanceData {
  balance: number;
}

interface SidebarProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  onWorkspaceSelect: (id: string) => void;
  onCreateWorkspace: () => void;
  loadingWorkspaces: boolean;
}

function formatBalance(balance: number): string {
  if (balance >= 1_000_000) {
    return (balance / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (balance >= 1_000) {
    return (balance / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return balance.toLocaleString('cs-CZ');
}

function WorkspaceIcon({ type }: { type: 'home' | 'public' | 'shared' }): React.JSX.Element {
  if (type === 'home') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    );
  }
  if (type === 'public') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.97.633-3.794 1.708-5.278"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

function WorkspaceButton({
  ws,
  selected,
  onClick,
}: {
  ws: Workspace;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        selected
          ? 'bg-slate-200 font-medium text-slate-900'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      ].join(' ')}
    >
      <WorkspaceIcon type={ws.type} />
      <span className="truncate">{ws.name}</span>
      <span className="ml-auto shrink-0 text-xs text-slate-400">{ws._count.items}</span>
    </button>
  );
}

export function Sidebar({
  workspaces,
  selectedWorkspaceId,
  onWorkspaceSelect,
  onCreateWorkspace,
  loadingWorkspaces,
}: SidebarProps): React.JSX.Element {
  const { data: session } = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session?.user) return;
    void (async () => {
      try {
        const res = await apiFetch('/api/billing/balance');
        if (res.ok) {
          const data = (await res.json()) as BalanceData;
          setBalance(data.balance);
        }
      } catch {
        // ignore
      }
    })();
  }, [session?.user]);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const user = session?.user;
  const initials = user
    ? (user.name ?? user.email ?? '?')
        .split(/[\s@]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  const displayName = user?.name ?? user?.email ?? '';
  const t = useTranslations('sidebar');
  const formattedBalance =
    balance !== null ? t('tokenBalance', { count: formatBalance(balance) }) : null;

  const homeWorkspaces = workspaces.filter((ws) => ws.type === 'home');
  const publicWorkspaces = workspaces.filter((ws) => ws.type === 'public');
  const sharedWorkspaces = workspaces.filter((ws) => ws.type === 'shared');

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      {/* Logo */}
      <div className="border-b border-slate-200 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-wide text-slate-800">
          A<span className="text-slate-400">i</span>Sedlacek
        </Link>
      </div>

      {/* Workspace list */}
      <nav className="flex-1 overflow-y-auto p-2">
        {loadingWorkspaces ? (
          <div className="px-2 py-2 text-xs text-slate-400">{t('loading')}</div>
        ) : (
          <>
            {homeWorkspaces.map((ws) => (
              <WorkspaceButton
                key={ws.id}
                ws={ws}
                selected={selectedWorkspaceId === ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
              />
            ))}

            {publicWorkspaces.map((ws) => (
              <WorkspaceButton
                key={ws.id}
                ws={ws}
                selected={selectedWorkspaceId === ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
              />
            ))}

            {/* Shared section */}
            <div className="my-2 h-px bg-slate-200" />
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {t('shared')}
              </span>
              <button
                onClick={onCreateWorkspace}
                className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                title={t('newSharedWorkspace')}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            {sharedWorkspaces.length === 0 && (
              <p className="px-2 py-1 text-xs text-slate-400">{t('noSharedWorkspaces')}</p>
            )}
            {sharedWorkspaces.map((ws) => (
              <WorkspaceButton
                key={ws.id}
                ws={ws}
                selected={selectedWorkspaceId === ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
              />
            ))}
          </>
        )}
      </nav>

      {/* User section at bottom */}
      {user && (
        <div ref={menuRef} className="relative border-t border-slate-200 p-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <LocaleSwitcher />
          </div>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-white">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name ?? 'Avatar'}
                  className="h-7 w-7 rounded-full"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{displayName}</p>
              {formattedBalance && <p className="text-[10px] text-slate-500">{formattedBalance}</p>}
            </div>
            <svg
              className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {userMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              <Link
                href="/workspace/billing"
                onClick={() => setUserMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
                  />
                </svg>
                {t('topUpTokens')}
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
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
                  />
                </svg>
                {t('logout')}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
