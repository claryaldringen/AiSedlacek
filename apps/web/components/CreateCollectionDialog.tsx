'use client';

import { useState, useEffect, useCallback } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (collection: { id: string; name: string }) => void;
  workspaceId?: string;
}

export function CreateCollectionDialog({
  open,
  onClose,
  onCreated,
  workspaceId,
}: Props): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const handleCreate = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = { name: trimmed };
      if (workspaceId) body.workspaceId = workspaceId;

      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { id: string; name: string };
      onCreated(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznama chyba');
    } finally {
      setSaving(false);
    }
  }, [name, workspaceId, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">Novy svazek</h2>

        <input
          type="text"
          placeholder="Nazev svazku..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              void handleCreate();
            }
            if (e.key === 'Escape') {
              onClose();
            }
            e.stopPropagation();
          }}
          autoFocus
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Zrusit
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || saving}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {saving ? 'Vytvarim...' : 'Vytvorit'}
          </button>
        </div>
      </div>
    </div>
  );
}
