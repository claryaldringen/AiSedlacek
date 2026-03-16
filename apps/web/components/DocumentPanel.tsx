'use client';

import { useEffect } from 'react';
import { ResultViewer, type DocumentResult } from './ResultViewer';
import type { PageItem } from './FileGrid';

interface DocumentPanelProps {
  /** The page being viewed */
  page: PageItem | null;
  /** Processed document result (only for done pages) */
  result: DocumentResult | null;
  isLoading: boolean;
  onClose: () => void;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

export function DocumentPanel({
  page,
  result,
  isLoading,
  onClose,
}: DocumentPanelProps): React.JSX.Element | null {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!page && !isLoading) return null;

  const status = page?.status ?? 'pending';
  const title = page ? cleanFilename(page.filename) : 'Dokument';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden="true" />

      {/* Slide-out panel */}
      <aside className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <p className="text-xs text-slate-400">
              {status === 'done' && 'Zpracováno'}
              {status === 'pending' && 'Čeká na zpracování'}
              {status === 'processing' && 'Zpracovává se…'}
              {status === 'error' && 'Chyba zpracování'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            aria-label="Zavřít panel"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <svg className="mx-auto mb-3 h-8 w-8 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-slate-500">Načítám…</p>
              </div>
            </div>
          ) : status === 'done' && result ? (
            <ResultViewer result={result} />
          ) : status === 'error' ? (
            <div className="space-y-4">
              {/* Error message */}
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h3 className="mb-1 text-sm font-semibold text-red-700">Chyba zpracování</h3>
                <p className="text-sm text-red-600">
                  {page?.errorMessage ?? 'Při zpracování dokumentu došlo k neznámé chybě.'}
                </p>
              </div>
              {/* Still show original image */}
              {page && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <img src={page.imageUrl} alt={title} className="w-full" />
                </div>
              )}
            </div>
          ) : page ? (
            <div className="space-y-4">
              {/* Pending / processing – show original image */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-sm text-slate-500">
                  {status === 'processing'
                    ? 'Dokument se právě zpracovává…'
                    : 'Dokument zatím nebyl zpracován. Vyberte ho a klikněte na "Zpracovat".'}
                </p>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <img src={page.imageUrl} alt={title} className="w-full" />
              </div>
              {page.width && page.height && (
                <p className="text-xs text-slate-400">
                  {page.width} × {page.height} px
                  {page.fileSize ? ` · ${(page.fileSize / 1024).toFixed(0)} KB` : ''}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
