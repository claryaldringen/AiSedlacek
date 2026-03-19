'use client';

import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CollectionContextDialogProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
  initialContext: string;
  initialContextUrl: string | null;
  onSaved: (context: string, contextUrl: string | null) => void;
}

export function CollectionContextDialog({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  initialContext,
  initialContextUrl,
  onSaved,
}: CollectionContextDialogProps): React.JSX.Element | null {
  const [context, setContext] = useState(initialContext);
  const [contextUrl, setContextUrl] = useState(initialContextUrl ?? '');
  const [editing, setEditing] = useState(!initialContext);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setContext(initialContext);
      setContextUrl(initialContextUrl ?? '');
      setEditing(!initialContext);
      setError(null);
    }
  }, [isOpen, initialContext, initialContextUrl]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, contextUrl: contextUrl.trim() || null }),
      });
      if (!res.ok) throw new Error('Ukládání selhalo');
      onSaved(context, contextUrl.trim() || null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setSaving(false);
    }
  }, [collectionId, context, contextUrl, onSaved]);

  const handleFetchFromUrl = useCallback(async () => {
    if (!contextUrl.trim()) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/fetch-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: contextUrl.trim() }),
      });
      let data: { context?: string; error?: string };
      try {
        data = (await res.json()) as { context?: string; error?: string };
      } catch {
        throw new Error(`Server vrátil ${res.status} bez platné odpovědi`);
      }
      if (!res.ok) throw new Error(data.error ?? 'Stahování selhalo');
      setContext(data.context ?? '');
      setEditing(false);
      onSaved(data.context ?? '', contextUrl.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setFetching(false);
    }
  }, [collectionId, contextUrl, onSaved]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Kontext díla</h2>
            <p className="text-xs text-slate-400">{collectionName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* URL import */}
        <div className="shrink-0 border-b border-slate-100 px-6 py-3">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Načíst kontext z URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={contextUrl}
              onChange={(e) => setContextUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && contextUrl.trim()) void handleFetchFromUrl();
                e.stopPropagation();
              }}
              placeholder="https://… (stránka s popisem díla)"
              disabled={fetching}
              className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              onClick={() => void handleFetchFromUrl()}
              disabled={!contextUrl.trim() || fetching}
              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {fetching ? 'Stahuji…' : 'Stáhnout'}
            </button>
          </div>
        </div>

        {/* Context editor / preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {editing ? (
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Zadejte kontext díla v markdown formátu…&#10;&#10;Například: název, autor, datace, jazyk, obsah, historický kontext…"
              rows={15}
              className="w-full resize-none rounded border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          ) : context ? (
            <div className="prose prose-sm prose-stone max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{context}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-center text-sm text-slate-400">
              Žádný kontext. Zadejte text nebo stáhněte z URL.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-6 py-4">
          <div>
            {!editing && context && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Upravit
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Zavřít
            </button>
            {editing && (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Ukládám…' : 'Uložit'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
