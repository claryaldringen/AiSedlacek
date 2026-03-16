'use client';

import { useEffect } from 'react';
import { ResultViewer, type DocumentResult } from './ResultViewer';
import type { PageItem } from './FileGrid';

interface DocumentPanelProps {
  page: PageItem | null;
  result: DocumentResult | null;
  isLoading: boolean;
  onClose: () => void;
  onResultUpdate?: (updated: DocumentResult) => void;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

export function DocumentPanel({
  page,
  result,
  isLoading,
  onClose,
  onResultUpdate,
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
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />

      {/* Fullscreen panel */}
      <div className="fixed inset-4 z-40 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-800 px-6 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <p className="text-xs text-slate-400">
              {status === 'done' && 'Zpracováno'}
              {status === 'pending' && 'Čeká na zpracování'}
              {status === 'processing' && 'Zpracovává se…'}
              {status === 'error' && 'Chyba zpracování'}
              {page?.width && page.height && (
                <span className="ml-2">
                  {page.width} × {page.height} px
                  {page.fileSize ? ` · ${(page.fileSize / 1024).toFixed(0)} KB` : ''}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            aria-label="Zavřít"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content: split view */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: original image */}
          {page && (
            <div className="flex w-1/2 flex-col border-r border-slate-200 bg-slate-50">
              <div className="shrink-0 border-b border-slate-100 px-4 py-2">
                <span className="text-xs font-medium text-slate-500">Originál</span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <img
                  src={page.imageUrl}
                  alt={title}
                  className="w-full rounded shadow-sm"
                />
              </div>
            </div>
          )}

          {/* Right: result / status */}
          <div className="flex w-1/2 flex-col">
            <div className="shrink-0 border-b border-slate-100 px-4 py-2">
              <span className="text-xs font-medium text-slate-500">
                {status === 'done' ? 'Přepis a překlad' : 'Stav'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
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
                <ResultViewer result={result} onUpdate={onResultUpdate} />
              ) : status === 'error' ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-red-700">Chyba zpracování</h3>
                  <p className="text-sm text-red-600">
                    {page?.errorMessage ?? 'Při zpracování dokumentu došlo k neznámé chybě.'}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-sm text-slate-500">
                    {status === 'processing'
                      ? 'Dokument se právě zpracovává…'
                      : 'Dokument zatím nebyl zpracován. Vyberte ho a klikněte na „Zpracovat".'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
