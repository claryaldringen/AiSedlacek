'use client';

import { useState } from 'react';
import type { Collection } from './Sidebar';

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

interface FileGridProps {
  pages: PageItem[];
  collections: Collection[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onPageClick: (page: PageItem) => void;
  onCollectionClick: (id: string) => void;
  processingPageIds: Set<string>;
  showCollections?: boolean;
  onMovePages?: (pageIds: string[], targetCollectionId: string) => void;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'done':
      return (
        <span
          title="Zpracováno"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </span>
      );
    case 'processing':
      return (
        <span
          title="Zpracovává se"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 shadow"
        >
          <svg className="h-3 w-3 animate-spin text-white" fill="none" viewBox="0 0 24 24">
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
        </span>
      );
    case 'error':
      return (
        <span
          title="Chyba"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </span>
      );
    default:
      return (
        <span
          title="Čeká na zpracování"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </span>
      );
  }
}

export function FileGrid({
  pages,
  collections,
  selected,
  onToggleSelect,
  onPageClick,
  onCollectionClick,
  processingPageIds,
  showCollections = true,
  onMovePages,
}: FileGridProps): React.JSX.Element {
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);

  const getDraggedPageIds = (e: React.DragEvent): string[] => {
    try {
      const raw = e.dataTransfer.getData('application/x-page-ids');
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      // ignore
    }
    return [];
  };

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
    <div className="p-4">
      {/* Collections (folders) */}
      {showCollections && collections.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Svazky
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {collections.map((col) => (
              <button
                key={col.id}
                onClick={() => onCollectionClick(col.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverCollectionId(col.id);
                }}
                onDragLeave={() => setDragOverCollectionId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCollectionId(null);
                  const ids = getDraggedPageIds(e);
                  if (ids.length > 0) onMovePages?.(ids, col.id);
                }}
                className={[
                  'group relative cursor-pointer rounded-lg border-2 transition-all',
                  dragOverCollectionId === col.id
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-transparent hover:border-slate-300 hover:shadow-sm',
                ].join(' ')}
              >
                <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md bg-amber-50">
                  <svg
                    className="h-20 w-20 text-yellow-400 transition-transform group-hover:scale-105"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 12h-15a4.483 4.483 0 0 0-3 1.146Z" />
                  </svg>
                  <span className="absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm">
                    {col._count.pages} str.
                  </span>
                </div>
                <div className="px-1 pb-2 pt-1.5">
                  <p className="truncate text-xs font-medium text-slate-700">{col.name}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pages grid */}
      {pages.length > 0 && (
        <div>
          {showCollections && collections.length > 0 && (
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Stránky
            </h3>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pages.map((page) => {
              const isSelected = selected.has(page.id);
              const effectiveStatus = processingPageIds.has(page.id) ? 'processing' : page.status;
              const isDone = page.status === 'done';

              const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
                // If this page is selected, drag all selected; otherwise drag just this one
                const ids = isSelected ? Array.from(selected) : [page.id];
                e.dataTransfer.setData('application/x-page-ids', JSON.stringify(ids));
                e.dataTransfer.effectAllowed = 'move';
                // Show count badge if multiple
                if (ids.length > 1) {
                  const ghost = document.createElement('div');
                  ghost.textContent = `${ids.length.toString()} stránek`;
                  ghost.style.cssText =
                    'position:fixed;top:-9999px;background:#3b82f6;color:white;padding:4px 10px;border-radius:8px;font-size:13px;font-weight:600;';
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }
              };

              return (
                <div
                  key={page.id}
                  draggable
                  onDragStart={handleDragStart}
                  className={[
                    'group relative cursor-pointer rounded-lg border-2 transition-all',
                    isSelected
                      ? 'border-blue-500 shadow-md shadow-blue-100'
                      : 'border-transparent hover:border-slate-300 hover:shadow-sm',
                    'dragging:opacity-50',
                  ].join(' ')}
                  style={{ WebkitUserDrag: 'element' } as React.CSSProperties}
                  onClick={() => {
                    if (isDone) onPageClick(page);
                  }}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-slate-100">
                    <img
                      src={page.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />

                    {/* Processing overlay */}
                    {effectiveStatus === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <svg
                          className="h-8 w-8 animate-spin text-white"
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
                      </div>
                    )}

                    {/* Checkbox overlay (top-left) */}
                    <div
                      className={[
                        'absolute left-1.5 top-1.5 transition-opacity',
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(page.id);
                      }}
                    >
                      <div
                        className={[
                          'flex h-5 w-5 items-center justify-center rounded border-2 bg-white shadow-sm transition-colors',
                          isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300',
                        ].join(' ')}
                      >
                        {isSelected && (
                          <svg
                            className="h-3 w-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m4.5 12.75 6 6 9-13.5"
                            />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Status badge (bottom-right) */}
                    <div className="absolute bottom-1.5 right-1.5">
                      <StatusBadge status={effectiveStatus} />
                    </div>
                  </div>

                  {/* Filename */}
                  <div className="px-1 pb-2 pt-1.5">
                    <p
                      className="truncate text-xs text-slate-700"
                      title={cleanFilename(page.filename)}
                    >
                      {cleanFilename(page.filename)}
                    </p>
                    {page.document && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {page.document.detectedLanguage}
                        {page.document.translations.length > 0 &&
                          ` → ${page.document.translations[0]?.language ?? ''}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
