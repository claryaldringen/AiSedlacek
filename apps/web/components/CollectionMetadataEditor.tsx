'use client';

import { useState, useCallback } from 'react';

interface CollectionMetadata {
  title?: string | null;
  author?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  librarySignature?: string | null;
  abstract?: string | null;
}

interface Props {
  collectionId: string;
  metadata: CollectionMetadata;
  onSaved?: () => void;
}

export function CollectionMetadataEditor({
  collectionId,
  metadata,
  onSaved,
}: Props): React.JSX.Element {
  const [title, setTitle] = useState(metadata.title ?? '');
  const [author, setAuthor] = useState(metadata.author ?? '');
  const [yearFrom, setYearFrom] = useState(metadata.yearFrom?.toString() ?? '');
  const [yearTo, setYearTo] = useState(metadata.yearTo?.toString() ?? '');
  const [librarySignature, setLibrarySignature] = useState(metadata.librarySignature ?? '');
  const [abstract, setAbstract] = useState(metadata.abstract ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          author: author.trim() || null,
          yearFrom: yearFrom.trim() ? parseInt(yearFrom, 10) : null,
          yearTo: yearTo.trim() ? parseInt(yearTo, 10) : null,
          librarySignature: librarySignature.trim() || null,
          abstract: abstract.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uložení selhalo');
    } finally {
      setSaving(false);
    }
  }, [collectionId, title, author, yearFrom, yearTo, librarySignature, abstract, onSaved]);

  const inputClass =
    'w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-1 focus:ring-blue-400';
  const labelClass = 'block text-xs font-medium text-slate-500 mb-1';

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Název díla</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="např. Kronika česká"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Autor</label>
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="např. Kosmas"
          className={inputClass}
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className={labelClass}>Rok od</label>
          <input
            type="number"
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            placeholder="např. 1125"
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Rok do</label>
          <input
            type="number"
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            placeholder="např. 1140"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Signatura</label>
        <input
          type="text"
          value={librarySignature}
          onChange={(e) => setLibrarySignature(e.target.value)}
          placeholder="např. MS.7756"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Abstrakt</label>
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          rows={3}
          placeholder="Krátký popis díla…"
          className={inputClass + ' resize-none'}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="w-full rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
      >
        {saving ? 'Ukládám…' : 'Uložit metadata'}
      </button>
    </div>
  );
}
