'use client';

import { useState, useEffect, useCallback } from 'react';

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  _count: { pages: number };
}

interface CollectionSelectorProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCollectionCreated?: (collection: Collection) => void;
}

export function CollectionSelector({
  selectedId,
  onSelect,
  onCollectionCreated,
}: CollectionSelectorProps): React.JSX.Element {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/collections');
      const data = (await res.json()) as Collection[];
      setCollections(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

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

      const newCollection: Collection = data;
      setCollections((prev) => [newCollection, ...prev]);
      setNewName('');
      setNewDescription('');
      setShowNewForm(false);
      onSelect(newCollection.id);
      onCollectionCreated?.(newCollection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Svazek</h2>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="rounded border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50"
        >
          {showNewForm ? 'Zrušit' : '+ Nový svazek'}
        </button>
      </div>

      {showNewForm && (
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm space-y-2">
          <input
            type="text"
            placeholder="Název svazku"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Popis (volitelně)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
            className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {creating ? 'Vytvářím…' : 'Vytvořit'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-stone-400">Načítám svazky…</p>
      ) : (
        <div className="space-y-1">
          <button
            onClick={() => onSelect(null)}
            className={[
              'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              selectedId === null
                ? 'border-stone-700 bg-stone-50 font-medium text-stone-900'
                : 'border-stone-100 bg-white text-stone-600 hover:border-stone-200 hover:bg-stone-50',
            ].join(' ')}
          >
            Vše (bez svazku)
          </button>
          {collections.map((col) => (
            <button
              key={col.id}
              onClick={() => onSelect(col.id)}
              className={[
                'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                selectedId === col.id
                  ? 'border-stone-700 bg-stone-50 font-medium text-stone-900'
                  : 'border-stone-100 bg-white text-stone-600 hover:border-stone-200 hover:bg-stone-50',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{col.name}</span>
                <span className="ml-2 shrink-0 text-xs text-stone-400">
                  {col._count.pages} str.
                </span>
              </div>
              {col.description && (
                <p className="mt-0.5 truncate text-xs text-stone-400">{col.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
