'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/infrastructure/api-client';

interface Member {
  userId: string;
  role: string;
  user: { id: string; name: string | null; email: string | null } | null;
}

interface WorkspaceDetail {
  id: string;
  name: string;
  ownerId: string | null;
  /** Jen pro vlastníka, ostatním null. */
  inviteCode: string | null;
  members: Member[];
}

type PendingAction =
  | { kind: 'rotate' }
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'leave' };

interface Props {
  workspaceId: string | null;
  onClose: () => void;
  /** Změnil se počet členů nebo položek (odebrání člena). */
  onChanged: () => void;
  /** Uživatel workspace opustil – rodič obnoví seznam a přepne jinam. */
  onLeft: () => void;
}

/**
 * Správa sdíleného workspace: pozvánkový kód (vlastník ho vidí a může vyměnit),
 * seznam členů, odebrání člena (vlastník) a opuštění workspace (člen).
 */
export function ManageWorkspaceDialog({
  workspaceId,
  onClose,
  onChanged,
  onLeft,
}: Props): React.JSX.Element | null {
  const t = useTranslations('manageWorkspaceDialog');
  const { data: session } = useSession();
  const myId = session?.user?.id ?? null;

  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (id: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/workspaces/${id}`);
        const data = (await res.json().catch(() => ({}))) as WorkspaceDetail & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDetail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('unknownError'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    setDetail(null);
    setPending(null);
    setCopied(false);
    if (workspaceId) void load(workspaceId);
  }, [workspaceId, load]);

  const memberName = (m: Member): string => m.user?.name || m.user?.email || t('unknownUser');

  const runPending = useCallback(async (): Promise<void> => {
    if (!detail || !pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'rotate') {
        const res = await apiFetch(`/api/workspaces/${detail.id}/invite-code`, { method: 'POST' });
        const data = (await res.json().catch(() => ({}))) as {
          inviteCode?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDetail({ ...detail, inviteCode: data.inviteCode ?? null });
        setCopied(false);
      } else {
        const targetId = pending.kind === 'leave' ? myId : pending.userId;
        if (!targetId) throw new Error(t('unknownError'));
        const res = await apiFetch(`/api/workspaces/${detail.id}/members/${targetId}`, {
          method: 'DELETE',
        });
        const data = (await res.json().catch(() => ({}))) as {
          inviteCode?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (pending.kind === 'leave') {
          setPending(null);
          onLeft();
          return;
        }
        setDetail({
          ...detail,
          inviteCode: data.inviteCode ?? detail.inviteCode,
          members: detail.members.filter((m) => m.userId !== targetId),
        });
        onChanged();
      }
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setBusy(false);
    }
  }, [detail, pending, myId, onChanged, onLeft, t]);

  const copyCode = useCallback(async (): Promise<void> => {
    if (!detail?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      setCopied(true);
    } catch {
      setError(t('copyFailed'));
    }
  }, [detail, t]);

  if (!workspaceId) return null;

  const isOwner = detail !== null && myId !== null && detail.ownerId === myId;
  const confirmText =
    pending?.kind === 'rotate'
      ? t('rotateConfirm')
      : pending?.kind === 'remove'
        ? t('removeConfirm', { name: pending.name })
        : pending?.kind === 'leave'
          ? t('leaveConfirm', { name: detail?.name ?? '' })
          : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-800">
          {t('title')}
          {detail ? `: ${detail.name}` : ''}
        </h2>

        {loading && <p className="text-sm text-slate-500">{t('loading')}</p>}

        {detail && (
          <div className="space-y-5">
            {isOwner && (
              <section>
                <h3 className="mb-1 text-sm font-medium text-slate-700">{t('inviteCode')}</h3>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800">
                    {detail.inviteCode ?? '—'}
                  </code>
                  <button
                    onClick={() => void copyCode()}
                    disabled={!detail.inviteCode}
                    className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    {copied ? t('copied') : t('copy')}
                  </button>
                  <button
                    onClick={() => setPending({ kind: 'rotate' })}
                    disabled={busy}
                    className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    {t('rotate')}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">{t('inviteHint')}</p>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-sm font-medium text-slate-700">{t('members')}</h3>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {detail.members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="truncate text-slate-800">{memberName(m)}</span>
                    {m.userId === detail.ownerId && (
                      <span className="rounded bg-slate-100 px-1.5 text-[10px] uppercase text-slate-500">
                        {t('ownerBadge')}
                      </span>
                    )}
                    {m.userId === myId && (
                      <span className="text-xs text-slate-400">{t('you')}</span>
                    )}
                    {isOwner && m.userId !== detail.ownerId && (
                      <button
                        onClick={() =>
                          setPending({ kind: 'remove', userId: m.userId, name: memberName(m) })
                        }
                        disabled={busy}
                        className="ml-auto rounded-md px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        {t('remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {!isOwner && (
              <section>
                <button
                  onClick={() => setPending({ kind: 'leave' })}
                  disabled={busy}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  {t('leave')}
                </button>
              </section>
            )}

            {pending && confirmText && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{confirmText}</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setPending(null)}
                    disabled={busy}
                    className="rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-amber-100"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={() => void runPending()}
                    disabled={busy}
                    className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
                  >
                    {busy ? t('working') : t('confirm')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
