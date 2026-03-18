'use client';

import { useState } from 'react';

interface ToolbarProps {
  totalCount: number;
  doneCount: number;
  selectedCount: number;
  pendingSelectedCount: number;
  isProcessing: boolean;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onImportClick: () => void;
  onProcessSelected: () => void;
  onDeleteSelected: () => void;
  onMoveSelected?: () => void;
  onCreateCollection?: (name: string) => void;
  onSortByName?: () => void;
  onEditContext?: () => void;
  hasCollection?: boolean;
  processingStep?: string;
  processingProgress?: number;
}

export function Toolbar({
  totalCount,
  doneCount,
  selectedCount,
  pendingSelectedCount,
  isProcessing,
  viewMode,
  onViewModeChange,
  onImportClick,
  onProcessSelected,
  onDeleteSelected,
  onCreateCollection,
  onSortByName,
  onEditContext,
  hasCollection,
  processingStep,
  processingProgress,
}: ToolbarProps): React.JSX.Element {
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  return (
    <div className="flex flex-col border-b border-slate-200 bg-white">
      {/* Main toolbar row */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* Import button */}
        <button
          onClick={onImportClick}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Vložit
        </button>

        {/* New collection */}
        {onCreateCollection && (
          showNewCollection ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="Název svazku…"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCollectionName.trim()) {
                    onCreateCollection(newCollectionName.trim());
                    setNewCollectionName('');
                    setShowNewCollection(false);
                  }
                  if (e.key === 'Escape') {
                    setNewCollectionName('');
                    setShowNewCollection(false);
                  }
                  e.stopPropagation();
                }}
                autoFocus
                className="w-40 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={() => {
                  if (newCollectionName.trim()) {
                    onCreateCollection(newCollectionName.trim());
                    setNewCollectionName('');
                    setShowNewCollection(false);
                  }
                }}
                disabled={!newCollectionName.trim()}
                className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Vytvořit
              </button>
              <button
                onClick={() => { setNewCollectionName(''); setShowNewCollection(false); }}
                className="rounded px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600"
              >
                Zrušit
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewCollection(true)}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nový svazek
            </button>
          )
        )}

        {/* Divider */}
        <div className="h-5 w-px bg-slate-200" />

        {/* Selected actions */}
        {selectedCount > 0 && (
          <>
            <button
              onClick={onProcessSelected}
              disabled={pendingSelectedCount === 0 || isProcessing}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                />
              </svg>
              Zpracovat
              {pendingSelectedCount > 0 && (
                <span className="ml-0.5 text-xs text-slate-500">({pendingSelectedCount})</span>
              )}
            </button>

            <button
              onClick={onDeleteSelected}
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
              Smazat ({selectedCount})
            </button>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <span className="text-sm text-slate-500">
          {totalCount} {totalCount === 1 ? 'položka' : totalCount < 5 ? 'položky' : 'položek'}
          {doneCount > 0 && <span className="ml-1 text-slate-400">· {doneCount} zpracováno</span>}
          {selectedCount > 0 && (
            <span className="ml-1 text-blue-600">· {selectedCount} vybráno</span>
          )}
        </span>

        {/* Collection context */}
        {hasCollection && onEditContext && (
          <button
            onClick={onEditContext}
            title="Kontext díla"
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </button>
        )}

        {/* Sort by name */}
        {onSortByName && (
          <button
            onClick={onSortByName}
            title="Seřadit podle názvu"
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
          </button>
        )}

        {/* View toggle */}
        <div className="flex overflow-hidden rounded border border-slate-200">
          <button
            onClick={() => onViewModeChange('grid')}
            title="Mřížka"
            className={[
              'p-1.5 transition-colors',
              viewMode === 'grid'
                ? 'bg-slate-100 text-slate-800'
                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
            ].join(' ')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
              />
            </svg>
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            title="Seznam"
            className={[
              'p-1.5 transition-colors',
              viewMode === 'list'
                ? 'bg-slate-100 text-slate-800'
                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
            ].join(' ')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Processing status bar */}
      {isProcessing && (
        <div className="border-t border-slate-100 bg-blue-50 px-4 py-2">
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
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
            <span className="flex-1 text-sm text-blue-700">{processingStep ?? 'Zpracovávám…'}</span>
            {processingProgress != null && (
              <span className="text-xs text-blue-600">{Math.round(processingProgress)}%</span>
            )}
          </div>
          {processingProgress != null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${Math.min(processingProgress, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
