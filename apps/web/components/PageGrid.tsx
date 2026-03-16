'use client';

import { useState, useCallback } from 'react';

export interface PageItem {
  id: string;
  filename: string;
  imageUrl: string;
  status: string;
  order: number;
  collectionId: string | null;
  createdAt?: string;
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
  onDelete?: (pageId: string) => void;
  processingPageIds?: Set<string>;
}

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  processing: '◌',
  done: '●',
  error: '✕',
  archived: '◇',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Čeká',
  processing: 'Zpracovává se…',
  done: 'Zpracováno',
  error: 'Chyba',
  archived: 'Smazáno',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-stone-400',
  processing: 'text-blue-500 animate-spin',
  done: 'text-green-500',
  error: 'text-red-500',
  archived: 'text-stone-300',
};

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

export function PageGrid({
  pages,
  onProcessSelected,
  onPageClick,
  onDelete,
  processingPageIds = new Set(),
}: PageGridProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const handleDeleteSelected = useCallback(() => {
    if (!onDelete || selected.size === 0) return;
    for (const id of selected) {
      onDelete(id);
    }
    setSelected(new Set());
  }, [selected, onDelete]);

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-200 p-8 text-center">
        <p className="text-sm text-stone-400">Zatím žádné stránky. Nahrajte obrázky výše.</p>
      </div>
    );
  }

  const allSelected = selected.size === pages.length && pages.length > 0;
  const pendingSelected = Array.from(selected).filter((id) => {
    const p = pages.find((pg) => pg.id === id);
    return p && (p.status === 'pending' || p.status === 'error');
  });

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={allSelected ? deselectAll : selectAll}
            className="rounded border-stone-300"
          />
          {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
        </label>

        <div className="mx-2 h-4 w-px bg-stone-200" />

        <button
          onClick={handleProcess}
          disabled={pendingSelected.length === 0 || processingPageIds.size > 0}
          className="rounded bg-stone-800 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {processingPageIds.size > 0
            ? 'Zpracovává se…'
            : `Zpracovat${pendingSelected.length > 0 ? ` (${pendingSelected.length})` : ''}`}
        </button>

        {selected.size > 0 && onDelete && (
          <button
            onClick={handleDeleteSelected}
            className="rounded border border-red-200 bg-white px-3 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Smazat ({selected.size})
          </button>
        )}

        <span className="ml-auto text-xs text-stone-400">
          {pages.length} stránek · {pages.filter((p) => p.status === 'done').length} zpracováno
        </span>
      </div>

      {/* File list */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs text-stone-500">
              <th className="w-8 px-3 py-2" />
              <th className="w-10 px-2 py-2">Stav</th>
              <th className="px-2 py-2">Náhled</th>
              <th className="px-2 py-2">Název</th>
              <th className="px-2 py-2">Jazyky</th>
              <th className="w-20 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => {
              const isSelected = selected.has(page.id);
              const statusKey = processingPageIds.has(page.id) ? 'processing' : page.status;
              const isDone = page.status === 'done';

              return (
                <tr
                  key={page.id}
                  className={[
                    'border-b border-stone-50 transition-colors',
                    isSelected ? 'bg-stone-50' : 'hover:bg-stone-25',
                    isDone ? 'cursor-pointer' : '',
                  ].join(' ')}
                  onClick={() => isDone && onPageClick(page)}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(page.id)}
                      className="rounded border-stone-300"
                    />
                  </td>

                  {/* Status */}
                  <td className="px-2 py-2">
                    <span
                      className={`text-sm ${STATUS_COLOR[statusKey] ?? STATUS_COLOR['pending']}`}
                      title={STATUS_LABEL[statusKey] ?? statusKey}
                    >
                      {STATUS_ICON[statusKey] ?? '○'}
                    </span>
                  </td>

                  {/* Thumbnail */}
                  <td className="px-2 py-2">
                    <div className="h-10 w-8 overflow-hidden rounded border border-stone-100 bg-stone-50">
                      <img
                        src={page.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </td>

                  {/* Filename */}
                  <td className="px-2 py-2">
                    <span className="text-sm text-stone-700">{cleanFilename(page.filename)}</span>
                    {page.status === 'error' && (
                      <span className="ml-2 text-xs text-red-400">Zpracování selhalo</span>
                    )}
                  </td>

                  {/* Languages */}
                  <td className="px-2 py-2">
                    {page.document && (
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                          {page.document.detectedLanguage}
                        </span>
                        {page.document.translations.map((t) => (
                          <span
                            key={t.language}
                            className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600"
                          >
                            → {t.language}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(page.id)}
                        className="rounded p-1 text-stone-300 hover:bg-red-50 hover:text-red-500"
                        title={isDone ? 'Archivovat' : 'Smazat'}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
