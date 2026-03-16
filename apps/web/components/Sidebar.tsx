'use client';

import { useState, useCallback } from 'react';

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  _count: { pages: number };
}

interface SidebarProps {
  selectedCollectionId: string | null;
  onCollectionSelect: (id: string | null) => void;
  onCollectionCreated?: (collection: Collection) => void;
  collections: Collection[];
  loadingCollections: boolean;
  onRefresh: () => void;
  onMovePages?: (pageIds: string[], targetCollectionId: string | null) => void;
}

export function Sidebar({
  selectedCollectionId,
  onCollectionSelect,
  onCollectionCreated,
  collections,
  loadingCollections,
  onRefresh,
  onMovePages,
}: SidebarProps): React.JSX.Element {
  const [showNewForm, setShowNewForm] = useState(false);
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
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() }),
      });
      const data = (await res.json()) as Collection & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Nepodařilo se vytvořit svazek');

      setNewName('');
      setNewDescription('');
      setShowNewForm(false);
      onCollectionCreated?.(data);
      onRefresh();
      onCollectionSelect(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setCreating(false);
    }
  };

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
              <span className="shrink-0 text-xs opacity-60">{col._count.pages}</span>
            </button>
          ))
        )}
      </div>

      {/* New collection button at bottom */}
      <div className="border-t border-slate-700 p-3">
        {showNewForm ? (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Název svazku"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') setShowNewForm(false);
              }}
              autoFocus
              className="w-full rounded bg-slate-700 px-2.5 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Popis (volitelně)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full rounded bg-slate-700 px-2.5 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
                className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Vytvářím…' : 'Vytvořit'}
              </button>
              <button
                onClick={() => {
                  setShowNewForm(false);
                  setNewName('');
                  setNewDescription('');
                  setError(null);
                }}
                className="rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewForm(true)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nový svazek
          </button>
        )}
      </div>
    </aside>
  );
}
