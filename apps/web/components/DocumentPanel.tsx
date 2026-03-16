'use client';

import { useEffect } from 'react';
import { ResultViewer, type DocumentResult } from './ResultViewer';

interface DocumentPanelProps {
  result: DocumentResult | null;
  isLoading: boolean;
  onClose: () => void;
}

export function DocumentPanel({
  result,
  isLoading,
  onClose,
}: DocumentPanelProps): React.JSX.Element | null {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!result && !isLoading) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden="true" />

      {/* Slide-out panel */}
      <aside className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-white">Výsledek zpracování</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            aria-label="Zavřít panel"
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

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <svg
                  className="mx-auto mb-3 h-8 w-8 animate-spin text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <p className="text-sm text-slate-500">Načítám dokument…</p>
              </div>
            </div>
          ) : result ? (
            <ResultViewer result={result} />
          ) : null}
        </div>
      </aside>
    </>
  );
}
