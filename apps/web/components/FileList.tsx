'use client';

import type { PageItem } from './FileGrid';
import type { Collection } from './Sidebar';

interface FileListProps {
  pages: PageItem[];
  collections: Collection[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onPageClick: (page: PageItem) => void;
  onCollectionClick: (id: string) => void;
  onDelete: (id: string) => void;
  processingPageIds: Set<string>;
  showCollections?: boolean;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

function StatusCell({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'done':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Zpracováno
        </span>
      );
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-30"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-80"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Zpracovává se
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Chyba
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Čeká
        </span>
      );
  }
}

export function FileList({
  pages,
  collections,
  selected,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onPageClick,
  onCollectionClick,
  onDelete,
  processingPageIds,
  showCollections = true,
}: FileListProps): React.JSX.Element {
  const allItems = pages;
  const allSelected = selected.size === allItems.length && allItems.length > 0;
  const someSelected = selected.size > 0 && selected.size < allItems.length;

  if (pages.length === 0 && collections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <svg
          className="mb-4 h-16 w-16 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
          />
        </svg>
        <p className="text-slate-500">Tato složka je prázdná.</p>
        <p className="mt-1 text-sm text-slate-400">Nahrajte obrázky tlačítkem "Nahrát" výše.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <th className="w-10 px-4 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={allSelected ? onDeselectAll : onSelectAll}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            </th>
            <th className="w-12 px-2 py-2.5" />
            <th className="px-2 py-2.5 font-semibold">Název</th>
            <th className="px-2 py-2.5 font-semibold">Stav</th>
            <th className="px-2 py-2.5 font-semibold">Jazyk</th>
            <th className="px-2 py-2.5 font-semibold">Přidáno</th>
            <th className="w-16 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {/* Collections */}
          {showCollections &&
            collections.map((col) => (
              <tr
                key={`col-${col.id}`}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                onClick={() => onCollectionClick(col.id)}
              >
                <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  {/* Collections not selectable in list */}
                </td>
                <td className="px-2 py-2">
                  <svg className="h-8 w-8 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 12h-15a4.483 4.483 0 0 0-3 1.146Z" />
                  </svg>
                </td>
                <td className="px-2 py-2">
                  <span className="font-medium text-slate-700">{col.name}</span>
                  {col.description && (
                    <span className="ml-2 text-xs text-slate-400">{col.description}</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span className="text-xs text-slate-500">{col._count.pages} stránek</span>
                </td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2">
                  <span className="text-xs text-slate-400">
                    {new Date(col.createdAt).toLocaleDateString('cs-CZ')}
                  </span>
                </td>
                <td className="px-2 py-2" />
              </tr>
            ))}

          {/* Pages */}
          {pages.map((page) => {
            const isSelected = selected.has(page.id);
            const effectiveStatus = processingPageIds.has(page.id) ? 'processing' : page.status;
            const isDone = page.status === 'done';

            return (
              <tr
                key={page.id}
                className={[
                  'border-b border-slate-100 transition-colors',
                  isSelected ? 'bg-blue-50' : 'hover:bg-slate-50',
                  isDone ? 'cursor-pointer' : '',
                ].join(' ')}
                onClick={() => isDone && onPageClick(page)}
              >
                {/* Checkbox */}
                <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(page.id)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>

                {/* Thumbnail */}
                <td className="px-2 py-2">
                  <div className="h-10 w-8 overflow-hidden rounded border border-slate-200 bg-slate-100">
                    <img
                      src={page.thumbnailUrl ?? page.imageUrl}
                      alt={cleanFilename(page.filename)}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </td>

                {/* Name */}
                <td className="px-2 py-2">
                  <span className="text-slate-800">{cleanFilename(page.filename)}</span>
                </td>

                {/* Status */}
                <td className="px-2 py-2">
                  <StatusCell status={effectiveStatus} />
                </td>

                {/* Language */}
                <td className="px-2 py-2">
                  {page.document ? (
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
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
                  ) : (
                    <span className="text-xs text-slate-400">–</span>
                  )}
                </td>

                {/* Date */}
                <td className="px-2 py-2">
                  <span className="text-xs text-slate-400">
                    {page.createdAt ? new Date(page.createdAt).toLocaleDateString('cs-CZ') : '–'}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onDelete(page.id)}
                    title={isDone ? 'Archivovat' : 'Smazat'}
                    className="rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
