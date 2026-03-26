'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/infrastructure/api-client';

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
  hasContext?: boolean;
  onSaved?: () => void;
}

export function CollectionMetadataEditor({
  collectionId,
  metadata,
  hasContext,
  onSaved,
}: Props): React.JSX.Element {
  const t = useTranslations('collection');
  const [title, setTitle] = useState(metadata.title ?? '');
  const [author, setAuthor] = useState(metadata.author ?? '');
  const [yearFrom, setYearFrom] = useState(metadata.yearFrom?.toString() ?? '');
  const [yearTo, setYearTo] = useState(metadata.yearTo?.toString() ?? '');
  const [librarySignature, setLibrarySignature] = useState(metadata.librarySignature ?? '');
  const [abstract, setAbstract] = useState(metadata.abstract ?? '');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/collections/${collectionId}`, {
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
      setError(err instanceof Error ? err.message : t('savingMetadataFailed'));
    } finally {
      setSaving(false);
    }
  }, [t, collectionId, title, author, yearFrom, yearTo, librarySignature, abstract, onSaved]);

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/collections/${collectionId}/extract-metadata`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CollectionMetadata;
      setTitle(data.title ?? '');
      setAuthor(data.author ?? '');
      setYearFrom(data.yearFrom?.toString() ?? '');
      setYearTo(data.yearTo?.toString() ?? '');
      setLibrarySignature(data.librarySignature ?? '');
      setAbstract(data.abstract ?? '');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extractionFailed'));
    } finally {
      setExtracting(false);
    }
  }, [t, collectionId, onSaved]);

  const inputClass =
    'w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-1 focus:ring-blue-400';
  const labelClass = 'block text-xs font-medium text-slate-500 mb-1';

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>{t('metadataTitle')}</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('metadataTitlePlaceholder')}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('metadataAuthor')}</label>
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder={t('metadataAuthorPlaceholder')}
          className={inputClass}
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className={labelClass}>{t('metadataYearFrom')}</label>
          <input
            type="number"
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            placeholder="1125"
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>{t('metadataYearTo')}</label>
          <input
            type="number"
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            placeholder="1140"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>{t('metadataSignature')}</label>
        <input
          type="text"
          value={librarySignature}
          onChange={(e) => setLibrarySignature(e.target.value)}
          placeholder="MS.7756"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('metadataAbstract')}</label>
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          rows={3}
          placeholder={t('metadataAbstractPlaceholder')}
          className={inputClass + ' resize-none'}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || extracting}
          className="flex-1 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? t('savingMetadata') : t('saveMetadata')}
        </button>
        {hasContext && (
          <button
            onClick={() => void handleExtract()}
            disabled={extracting || saving}
            className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            title={t('extractMetadataTooltip')}
          >
            {extracting ? t('extractingMetadata') : t('extractMetadataFromContext')}
          </button>
        )}
      </div>
    </div>
  );
}
