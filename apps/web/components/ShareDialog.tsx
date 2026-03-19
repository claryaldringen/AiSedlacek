'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  itemType: 'collection' | 'page';
  itemName: string;
  currentIsPublic: boolean;
  currentSlug: string | null;
  onUpdate: (isPublic: boolean, slug: string | null) => void;
}

export function ShareDialog({
  isOpen,
  onClose,
  itemId,
  itemType,
  itemName,
  currentIsPublic,
  currentSlug,
  onUpdate,
}: ShareDialogProps): React.JSX.Element | null {
  const [isPublic, setIsPublic] = useState(currentIsPublic);
  const [slug, setSlug] = useState(currentSlug ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsPublic(currentIsPublic);
      setSlug(currentSlug ?? '');
      setError(null);
      setCopied(false);
    }
  }, [isOpen, currentIsPublic, currentSlug]);

  const apiEndpoint =
    itemType === 'collection' ? `/api/collections/${itemId}` : `/api/pages/${itemId}`;

  const publicUrl =
    slug.trim() !== ''
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/view/${slug.trim()}`
      : null;

  const handleTogglePublic = useCallback(async (): Promise<void> => {
    const newIsPublic = !isPublic;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: newIsPublic }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Chyba při ukládání');
      }
      const updated = (await res.json()) as { isPublic: boolean; slug: string | null };
      setIsPublic(updated.isPublic);
      setSlug(updated.slug ?? '');
      onUpdate(updated.isPublic, updated.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setSaving(false);
    }
  }, [isPublic, apiEndpoint, onUpdate]);

  const handleSaveSlug = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Chyba při ukládání');
      }
      const updated = (await res.json()) as { isPublic: boolean; slug: string | null };
      setSlug(updated.slug ?? '');
      onUpdate(updated.isPublic, updated.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setSaving(false);
    }
  }, [apiEndpoint, slug, onUpdate]);

  const handleCopy = useCallback((): void => {
    if (!publicUrl) return;
    void navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [publicUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="relative w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Sdílet veřejně</h2>
            <p className="mt-0.5 truncate text-sm text-slate-500" title={itemName}>
              {itemName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Error */}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Public toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Veřejný přístup</p>
              <p className="text-xs text-slate-400">
                {isPublic
                  ? 'Kdokoliv s odkazem může zobrazit tento dokument'
                  : 'Dokument je přístupný pouze vám'}
              </p>
            </div>
            <button
              onClick={() => void handleTogglePublic()}
              disabled={saving}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50',
                isPublic ? 'bg-blue-600' : 'bg-slate-200',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                  isPublic ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>

          {/* Slug + URL (only when public) */}
          {isPublic && (
            <div className="space-y-3">
              {/* Slug input */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Adresa odkazu (slug)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') void handleSaveSlug();
                    }}
                    placeholder="muj-dokument"
                    className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    onClick={() => void handleSaveSlug()}
                    disabled={saving || slug.trim() === ''}
                    className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
                  >
                    Uložit
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Pouze malá písmena, číslice a pomlčky.
                </p>
              </div>

              {/* Public URL */}
              {publicUrl && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Veřejný odkaz
                  </label>
                  <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="flex-1 truncate text-sm text-slate-700" title={publicUrl}>
                      {publicUrl}
                    </span>
                    <button
                      onClick={handleCopy}
                      title="Kopírovat odkaz"
                      className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                    >
                      {copied ? (
                        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.75a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}
