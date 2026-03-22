'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

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
  // Structured metadata
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
    // House icon
    return (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    );
  }
  if (type === 'public') {
    // Globe icon
    return (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.97.633-3.794 1.708-5.278"
        />
      </svg>
    );
  }
  // Users icon (shared)
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
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
  const formattedBalance = balance !== null ? formatBalance(balance) + ' tokenu' : null;

  // Sort workspaces: home first, then public, then shared
  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const order = { home: 0, public: 1, shared: 2 };
    return (order[a.type] ?? 3) - (order[b.type] ?? 3);
  });

  const homeWorkspaces = sortedWorkspaces.filter((ws) => ws.type === 'home');
  const publicWorkspaces = sortedWorkspaces.filter((ws) => ws.type === 'public');
  const sharedWorkspaces = sortedWorkspaces.filter((ws) => ws.type === 'shared');

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      {/* User info */}
      {user && (
        <div className="border-b border-slate-200 p-3">
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name ?? 'Avatar'}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{displayName}</p>
              {formattedBalance && (
                <p className="text-xs text-slate-500">{formattedBalance}</p>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <Link
              href="/workspace/billing"
              className="font-medium text-blue-600 transition-colors hover:text-blue-800"
            >
              Dobit
            </Link>
            <button
              onClick={() => void signOut()}
              className="font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Odhlasit
            </button>
          </div>
        </div>
      )}

      {/* Workspace list */}
      <nav className="flex-1 overflow-y-auto p-2">
        {/* Label */}
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Workspaces
        </div>

        {loadingWorkspaces ? (
          <div className="px-2 py-2 text-xs text-slate-400">Nacitam...</div>
        ) : (
          <>
            {/* Home workspace */}
            {homeWorkspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  selectedWorkspaceId === ws.id
                    ? 'bg-slate-200 font-medium text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
              >
                <WorkspaceIcon type="home" />
                <span className="truncate">{ws.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {ws._count.items}
                </span>
              </button>
            ))}

            {/* Public workspace */}
            {publicWorkspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  selectedWorkspaceId === ws.id
                    ? 'bg-slate-200 font-medium text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
              >
                <WorkspaceIcon type="public" />
                <span className="truncate">{ws.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {ws._count.items}
                </span>
              </button>
            ))}

            {/* Divider before shared workspaces */}
            {sharedWorkspaces.length > 0 && <div className="my-2 h-px bg-slate-200" />}

            {/* Shared workspaces */}
            {sharedWorkspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  selectedWorkspaceId === ws.id
                    ? 'bg-slate-200 font-medium text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
              >
                <WorkspaceIcon type="shared" />
                <span className="truncate">{ws.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {ws._count.items}
                </span>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Create workspace button at bottom */}
      <div className="border-t border-slate-200 p-2">
        <button
          onClick={onCreateWorkspace}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Novy workspace</span>
        </button>
      </div>
    </aside>
  );
}
