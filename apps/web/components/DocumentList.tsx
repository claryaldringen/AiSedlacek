'use client';

import { useState, useEffect, useCallback } from 'react';

interface DocumentSummary {
  id: string;
  filename: string;
  detectedLanguage: string;
  createdAt: string;
  transcription: string;
  translations: { language: string }[];
  _count: { glossary: number };
}

interface DocumentListProps {
  onSelect: (id: string) => void;
  refreshKey?: number;
}

export function DocumentList({ onSelect, refreshKey }: DocumentListProps): React.JSX.Element {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = (await res.json()) as DocumentSummary[];
      setDocuments(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return <p className="text-sm text-stone-400">Načítám knihovnu…</p>;
  }

  if (documents.length === 0) {
    return <p className="text-sm text-stone-400">Zatím žádné dokumenty. Nahrajte obrázek výše.</p>;
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => (
        <button
          key={doc.id}
          onClick={() => onSelect(doc.id)}
          className="w-full rounded-lg border border-stone-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-800">
              {doc.filename.replace(/^[a-f0-9-]+-/, '')}
            </span>
            <span className="text-xs text-stone-400">
              {new Date(doc.createdAt).toLocaleDateString('cs')}
            </span>
          </div>
          <div className="mt-1 flex gap-2">
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
              {doc.detectedLanguage}
            </span>
            {doc.translations.map((t) => (
              <span
                key={t.language}
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600"
              >
                {t.language}
              </span>
            ))}
            {doc._count.glossary > 0 && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">
                {doc._count.glossary} pojmů
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-stone-400">
            {doc.transcription.slice(0, 150)}…
          </p>
        </button>
      ))}
    </div>
  );
}
