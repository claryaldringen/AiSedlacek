'use client';

import { useState, useCallback } from 'react';

export interface Collection {
  id: string;
  name: string;
  description: string;
  context: string;
  contextUrls: string[];
  createdAt: string;
  isPublic: boolean;
  slug: string | null;
  _count: { pages: number };
  processableCount: number;
}

interface SidebarProps {
  selectedCollectionId: string | null;
  onCollectionSelect: (id: string | null) => void;
  collections: Collection[];
  loadingCollections: boolean;
  onMovePages?: (pageIds: string[], targetCollectionId: string | null) => void;
}

export function Sidebar({
  selectedCollectionId,
  onCollectionSelect,
  collections,
  loadingCollections,
  onMovePages,
}: SidebarProps): React.JSX.Element {
  const [dragOverId, setDragOverId] = useState<string | 'all' | null>(null);

  const getDraggedPageIds = useCallback((e: React.DragEvent): string[] => {
    try {
      const raw = e.dataTransfer.getData('application/x-page-ids');
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      // ignore
    }
    return [];
  }, []);

  return (
    <aside className="flex h-full w-56 flex-col bg-slate-800 text-slate-200">
      {/* Sidebar content */}
      <div className="flex-1 overflow-y-auto py-3">
        {/* All items */}
        <button
          onClick={() => onCollectionSelect(null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverId('all');
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const ids = getDraggedPageIds(e);
            if (ids.length > 0) onMovePages?.(ids, null);
          }}
          className={[
            'flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors',
            dragOverId === 'all'
              ? 'bg-blue-500/30 text-white ring-1 ring-inset ring-blue-400'
              : selectedCollectionId === null
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white',
          ].join(' ')}
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
            />
          </svg>
          <span className="truncate font-medium">Všechny dokumenty</span>
        </button>

        {/* Divider */}
        <div className="mx-4 my-2 border-t border-slate-700" />

        {/* Collections label */}
        <div className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Svazky
        </div>

        {loadingCollections ? (
          <div className="px-4 py-2 text-xs text-slate-500">Načítám…</div>
        ) : collections.length === 0 ? (
          <div className="px-4 py-2 text-xs text-slate-500">Žádné svazky</div>
        ) : (
          collections.map((col) => (
            <button
              key={col.id}
              onClick={() => onCollectionSelect(col.id)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverId(col.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                const ids = getDraggedPageIds(e);
                if (ids.length > 0) onMovePages?.(ids, col.id);
              }}
              className={[
                'flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors',
                dragOverId === col.id
                  ? 'bg-blue-500/30 text-white ring-1 ring-inset ring-blue-400'
                  : selectedCollectionId === col.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white',
              ].join(' ')}
            >
              <svg
                className="h-4 w-4 shrink-0 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 12h-15a4.483 4.483 0 0 0-3 1.146Z" />
              </svg>
              <span className="flex-1 truncate">{col.name}</span>
              {col.isPublic && (
                <svg
                  className="h-3 w-3 shrink-0 text-blue-400"
                  aria-label="Veřejně sdíleno"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <title>Veřejně sdíleno</title>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
              )}
              <span className="shrink-0 text-xs opacity-60">{col._count.pages}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
