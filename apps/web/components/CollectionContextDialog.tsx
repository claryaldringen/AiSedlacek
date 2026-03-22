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
  initialContextUrls: string[];
  onSaved: (context: string, contextUrls: string[]) => void;
}

export function CollectionContextDialog({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  initialContext,
  initialContextUrls,
  onSaved,
}: CollectionContextDialogProps): React.JSX.Element | null {
  const [context, setContext] = useState(initialContext);
  const [contextUrls, setContextUrls] = useState<string[]>(initialContextUrls);
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [editing, setEditing] = useState(!initialContext);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setContext(initialContext);
      setContextUrls(initialContextUrls);
      setUrlInput('');
      setTextInput('');
      setEditing(!initialContext);
      setError(null);
    }
  }, [isOpen, initialContext, initialContextUrls]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, contextUrls }),
      });
      if (!res.ok) throw new Error('Ukládání selhalo');
      onSaved(context, contextUrls);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setSaving(false);
    }
  }, [collectionId, context, contextUrls, onSaved]);

  const handleFetchFromUrl = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/fetch-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      let data: { context?: string; contextUrls?: string[]; error?: string };
      try {
        data = (await res.json()) as { context?: string; contextUrls?: string[]; error?: string };
      } catch {
        throw new Error(`Server vrátil ${res.status} bez platné odpovědi`);
      }
      if (!res.ok) throw new Error(data.error ?? 'Stahování selhalo');
      const newContext = data.context ?? '';
      const newUrls = data.contextUrls ?? contextUrls;
      setContext(newContext);
      setContextUrls(newUrls);
      setUrlInput('');
      setEditing(false);
      onSaved(newContext, newUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setFetching(false);
    }
  }, [collectionId, urlInput, contextUrls, onSaved]);

  const handleMergeText = useCallback(async () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/fetch-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      let data: { context?: string; contextUrls?: string[]; error?: string };
      try {
        data = (await res.json()) as { context?: string; contextUrls?: string[]; error?: string };
      } catch {
        throw new Error(`Server vrátil ${res.status} bez platné odpovědi`);
      }
      if (!res.ok) throw new Error(data.error ?? 'Sloučení selhalo');
      const newContext = data.context ?? '';
      const newUrls = data.contextUrls ?? contextUrls;
      setContext(newContext);
      setContextUrls(newUrls);
      setTextInput('');
      setEditing(false);
      onSaved(newContext, newUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setMerging(false);
    }
  }, [collectionId, textInput, contextUrls, onSaved]);

  const handleRemoveUrl = useCallback((urlToRemove: string) => {
    setContextUrls((prev) => prev.filter((u) => u !== urlToRemove));
  }, []);

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

        {/* Context editor / preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {(fetching || merging) && (
            <div className="mb-3 overflow-hidden rounded border border-blue-200 bg-blue-50">
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-blue-700">
                <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>{fetching ? 'Stahuji a zpracovávám kontext z URL...' : 'Slučuji text s kontextem...'}</span>
              </div>
              <div className="h-1 bg-blue-200">
                <div
                  className="h-full w-2/5 rounded-full bg-blue-600"
                  style={{ animation: 'indeterminate 1.5s ease-in-out infinite' }}
                />
              </div>
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

        {/* URL import */}
        <div className="shrink-0 border-t border-slate-100 px-6 py-3">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Načíst kontext z URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && urlInput.trim()) void handleFetchFromUrl();
                e.stopPropagation();
              }}
              placeholder="https://… (stránka s popisem díla)"
              disabled={fetching}
              className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              onClick={() => void handleFetchFromUrl()}
              disabled={!urlInput.trim() || fetching}
              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {fetching ? 'Načítám…' : 'Načíst'}
            </button>
          </div>

          {/* Text input */}
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Přidat informace z textu
            </label>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Vložte text s informacemi o díle (např. z katalogu, knihy, článku)…"
              rows={3}
              disabled={merging}
              className="w-full resize-none rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            />
            <div className="mt-1 flex justify-end">
              <button
                onClick={() => void handleMergeText()}
                disabled={!textInput.trim() || merging}
                className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
              >
                {merging ? 'Zpracovávám…' : 'Sloučit s kontextem'}
              </button>
            </div>
          </div>

          {/* Source URLs list */}
          {contextUrls.length > 0 && (
            <div className="mt-2 space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                Zdroje
              </span>
              {contextUrls.map((sourceUrl) => (
                <div key={sourceUrl} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-blue-600 hover:underline"
                  >
                    {sourceUrl}
                  </a>
                  <button
                    onClick={() => handleRemoveUrl(sourceUrl)}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-500"
                    title="Odebrat zdroj"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
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
