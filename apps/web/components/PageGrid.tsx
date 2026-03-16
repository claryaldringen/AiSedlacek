'use client';

import { useState, useCallback } from 'react';

export interface PageItem {
  id: string;
  filename: string;
  imageUrl: string;
  status: string;
  order: number;
  collectionId: string | null;
  document?: {
    id: string;
    detectedLanguage: string;
    translations: { language: string }[];
  } | null;
}

interface PageGridProps {
  pages: PageItem[];
  onProcessSelected: (pageIds: string[]) => void;
  onPageClick: (page: PageItem) => void;
  processingPageIds?: Set<string>;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Čeká',
  processing: 'Zpracovává se',
  done: 'Hotovo',
  error: 'Chyba',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-stone-100 text-stone-600',
  processing: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
};

export function PageGrid({
  pages,
  onProcessSelected,
  onPageClick,
  processingPageIds = new Set(),
}: PageGridProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(pages.map((p) => p.id)));
  }, [pages]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleProcess = useCallback(() => {
    if (selected.size === 0) return;
    onProcessSelected(Array.from(selected));
  }, [selected, onProcessSelected]);

  if (pages.length === 0) {
    return <p className="text-sm text-stone-400">Zatím žádné stránky. Nahrajte obrázky výše.</p>;
  }

  const allSelected = selected.size === pages.length && pages.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="rounded border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
        >
          {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
        </button>
        {selected.size > 0 && (
          <button
            onClick={deselectAll}
            className="rounded border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
          >
            Zrušit výběr ({selected.size})
          </button>
        )}
        <button
          onClick={handleProcess}
          disabled={selected.size === 0 || processingPageIds.size > 0}
          className="rounded bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processingPageIds.size > 0
            ? 'Zpracovává se…'
            : `Zpracovat vybrané${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {pages.map((page) => {
          const isSelected = selected.has(page.id);
          const isProcessing = processingPageIds.has(page.id);
          const statusKey = isProcessing ? 'processing' : page.status;

          return (
            <div
              key={page.id}
              className={[
                'group relative overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all',
                isSelected ? 'border-stone-700' : 'border-stone-200',
              ].join(' ')}
            >
              {/* Checkbox */}
              <button
                onClick={() => toggleOne(page.id)}
                aria-label={isSelected ? 'Odebrat výběr' : 'Vybrat stránku'}
                className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border-2 border-white bg-white/80 shadow transition-opacity"
              >
                {isSelected && (
                  <svg className="h-3 w-3 text-stone-800" viewBox="0 0 12 12" fill="currentColor">
                    <path
                      d="M10 3L5 8.5 2 5.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>

              {/* Status badge */}
              <span
                className={[
                  'absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-xs font-medium',
                  STATUS_COLORS[statusKey] ?? STATUS_COLORS['pending'],
                ].join(' ')}
              >
                {STATUS_LABELS[statusKey] ?? statusKey}
              </span>

              {/* Thumbnail */}
              <button
                onClick={() => onPageClick(page)}
                disabled={page.status !== 'done'}
                className="block w-full focus:outline-none"
                aria-label={`Zobrazit dokument: ${page.filename}`}
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-stone-100">
                  <img
                    src={page.imageUrl}
                    alt={page.filename}
                    className={[
                      'h-full w-full object-cover transition-opacity',
                      page.status === 'done' ? 'group-hover:opacity-90' : 'opacity-80',
                    ].join(' ')}
                  />
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50">
                      <svg
                        className="h-8 w-8 animate-spin text-stone-600"
                        xmlns="http://www.w3.org/2000/svg"
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </button>

              {/* Filename */}
              <div className="px-2 py-1.5">
                <p className="truncate text-xs text-stone-600" title={page.filename}>
                  {page.filename.replace(/^[a-f0-9-]+-/, '')}
                </p>
                {page.document && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded bg-stone-100 px-1 py-0.5 text-[10px] text-stone-500">
                      {page.document.detectedLanguage}
                    </span>
                    {page.document.translations.map((t) => (
                      <span
                        key={t.language}
                        className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-600"
                      >
                        {t.language}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
