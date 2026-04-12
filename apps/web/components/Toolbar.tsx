'use client';

import { useTranslations } from 'next-intl';

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
  onCreateCollection?: () => void;
  onSortByName?: () => void;
  onEditContext?: () => void;
  hasCollection?: boolean;
  processingStep?: string;
  processingProgress?: number;
  onCancelProcessing?: () => void;
  onPauseProcessing?: () => void;
  onResumeProcessing?: () => void;
  isPaused?: boolean;
  onDetectBlank?: () => void;
  detectingBlank?: boolean;
  onShareCollection?: () => void;
  isCollectionPublic?: boolean;
  onGenerateContext?: () => void;
  generatingContext?: boolean;
  doneSelectedCount?: number;
  onRenameCollection?: () => void;
}

const btnBase =
  'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border';
const btnDefault = `${btnBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const btnPrimary = `${btnBase} border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-700`;
const btnDanger = `${btnBase} border-red-200 bg-white text-red-600 hover:bg-red-50`;
const btnDisabled = 'disabled:cursor-not-allowed disabled:opacity-40';
const divider = 'mx-1 h-5 w-px bg-slate-200';

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
  onCancelProcessing,
  onPauseProcessing,
  onResumeProcessing,
  isPaused,
  onDetectBlank,
  detectingBlank,
  onShareCollection,
  isCollectionPublic,
  onGenerateContext,
  generatingContext,
  doneSelectedCount,
  onRenameCollection,
}: ToolbarProps): React.JSX.Element {
  const t = useTranslations('toolbar');
  return (
    <div className="flex flex-col border-b border-slate-200 bg-white">
      {/* Main toolbar row */}
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Group 1: Content */}
        <div className="flex items-center gap-1">
          <button onClick={onImportClick} className={btnPrimary}>
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('insert')}
          </button>

          {onCreateCollection && (
            <button onClick={onCreateCollection} className={btnDefault}>
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                />
              </svg>
              {t('newCollection')}
            </button>
          )}
        </div>

        <div className={divider} />

        {/* Group 2: Tools */}
        <div className="flex items-center gap-1">
          {hasCollection && onEditContext && (
            <button onClick={onEditContext} title={t('contextTitle')} className={btnDefault}>
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                />
              </svg>
              {t('context')}
            </button>
          )}

          {onShareCollection && (
            <button
              onClick={onShareCollection}
              title={isCollectionPublic ? t('share') : t('share')}
              className={
                isCollectionPublic
                  ? `${btnBase} border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100`
                  : btnDefault
              }
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                />
              </svg>
              {t('share')}
            </button>
          )}

          {onSortByName && (
            <button onClick={onSortByName} title={t('sortTitle')} className={btnDefault}>
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"
                />
              </svg>
              {t('sort')}
            </button>
          )}

          {onDetectBlank && (
            <button
              onClick={onDetectBlank}
              disabled={detectingBlank || isProcessing}
              title={t('detectBlankTitle')}
              className={`${btnDefault} ${btnDisabled}`}
            >
              {detectingBlank ? (
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
              ) : (
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
              )}
              {t('detectBlank')}
            </button>
          )}
        </div>

        {/* Group 3: Selected actions */}
        {selectedCount > 0 && (
          <>
            <div className={divider} />
            <div className="flex items-center gap-1">
              <button
                onClick={onProcessSelected}
                disabled={pendingSelectedCount === 0 || isProcessing}
                className={`${btnDefault} ${btnDisabled}`}
              >
                <svg
                  className="h-3.5 w-3.5"
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
                {t('process')}
                {pendingSelectedCount > 0 && (
                  <span className="text-slate-400">({pendingSelectedCount})</span>
                )}
              </button>

              {onGenerateContext && (doneSelectedCount ?? 0) > 0 && (
                <button
                  onClick={onGenerateContext}
                  disabled={generatingContext || isProcessing}
                  className={`${btnDefault} ${btnDisabled}`}
                >
                  {generatingContext ? (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                      />
                    </svg>
                  )}
                  {generatingContext
                    ? t('generatingContext')
                    : t('generateContext', { count: doneSelectedCount ?? 0 })}
                </button>
              )}

              {onRenameCollection && (
                <button onClick={onRenameCollection} className={btnDefault}>
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
                    />
                  </svg>
                  {t('rename')}
                </button>
              )}

              <button onClick={onDeleteSelected} className={`${btnDanger}`}>
                <svg
                  className="h-3.5 w-3.5"
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
                {t('delete', { count: selectedCount })}
              </button>
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <span className="text-xs text-slate-500">
          {t('items', { count: totalCount })}
          {doneCount > 0 && (
            <span className="ml-1 text-slate-400">
              · {t('processedCount', { count: doneCount })}
            </span>
          )}
          {selectedCount > 0 && (
            <span className="ml-1 text-blue-600">
              · {t('selectedCount', { count: selectedCount })}
            </span>
          )}
        </span>

        <div className={divider} />

        {/* Group 4: View */}
        <div className="flex overflow-hidden rounded-md border border-slate-200">
          <button
            onClick={() => onViewModeChange('grid')}
            title={t('gridView')}
            className={[
              'p-1.5 transition-colors',
              viewMode === 'grid'
                ? 'bg-slate-100 text-slate-800'
                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
            ].join(' ')}
          >
            <svg
              className="h-3.5 w-3.5"
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
            title={t('listView')}
            className={[
              'p-1.5 transition-colors',
              viewMode === 'list'
                ? 'bg-slate-100 text-slate-800'
                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
            ].join(' ')}
          >
            <svg
              className="h-3.5 w-3.5"
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
        <div
          className={[
            'border-t px-4 py-2',
            isPaused ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-blue-50',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            {isPaused ? (
              <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
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
            )}
            <span
              className={['flex-1 text-sm', isPaused ? 'text-amber-700' : 'text-blue-700'].join(
                ' ',
              )}
            >
              {processingStep ?? t('processingDefault')}
            </span>
            {processingProgress != null && (
              <span
                className={['text-xs', isPaused ? 'text-amber-600' : 'text-blue-600'].join(' ')}
              >
                {Math.round(processingProgress)}%
              </span>
            )}
            {/* Pause / Resume button */}
            {isPaused
              ? onResumeProcessing && (
                  <button
                    onClick={onResumeProcessing}
                    title={t('resumeTitle')}
                    className={`${btnBase} border border-blue-200 bg-white text-blue-600 hover:bg-blue-50`}
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                    </svg>
                    {t('resume')}
                  </button>
                )
              : onPauseProcessing && (
                  <button
                    onClick={onPauseProcessing}
                    title={t('pauseTitle')}
                    className={`${btnBase} border border-amber-200 bg-white text-amber-600 hover:bg-amber-50`}
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                    {t('pause')}
                  </button>
                )}
            {/* Stop / Cancel button */}
            {onCancelProcessing && (
              <button
                onClick={onCancelProcessing}
                title={t('cancelTitle')}
                className={`${btnBase} border border-red-200 bg-white text-red-600 hover:bg-red-50`}
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6V6z" />
                </svg>
                {t('cancel')}
              </button>
            )}
          </div>
          {processingProgress != null && (
            <div
              className={[
                'mt-1.5 h-1.5 overflow-hidden rounded-full',
                isPaused ? 'bg-amber-200' : 'bg-blue-200',
              ].join(' ')}
            >
              <div
                className={[
                  'h-full rounded-full transition-all duration-500',
                  isPaused ? 'bg-amber-500' : 'bg-blue-600',
                ].join(' ')}
                style={{ width: `${Math.min(processingProgress, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
