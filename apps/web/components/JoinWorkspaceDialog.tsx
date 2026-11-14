'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { Workspace } from './Sidebar';
import { apiFetch } from '@/lib/infrastructure/api-client';

interface Props {
  open: boolean;
  onClose: () => void;
  onJoined: (workspace: Workspace) => void;
}

/** Připojení ke sdílenému workspace pozvánkovým kódem od jeho vlastníka. */
export function JoinWorkspaceDialog({ open, onClose, onJoined }: Props): React.JSX.Element | null {
  const t = useTranslations('joinWorkspaceDialog');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const handleJoin = useCallback(async (): Promise<void> => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/workspaces/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as Workspace & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onJoined(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setSaving(false);
    }
  }, [code, onJoined, onClose, t]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">{t('title')}</h2>
        <input
          type="text"
          placeholder={t('codePlaceholder')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.trim()) void handleJoin();
            if (e.key === 'Escape') onClose();
            e.stopPropagation();
          }}
          autoFocus
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => void handleJoin()}
            disabled={!code.trim() || saving}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {saving ? t('joining') : t('join')}
          </button>
        </div>
      </div>
    </div>
  );
}
