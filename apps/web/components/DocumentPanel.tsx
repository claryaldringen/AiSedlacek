'use client';

import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ResultViewer, type DocumentResult, type ResultPatchHandler } from './ResultViewer';
import { DocumentChat } from './DocumentChat';
import { PanelSearchBar, type PanelSearchProps } from './PanelSearchBar';
import type { PageItem } from './FileGrid';
import { apiFetch } from '@/lib/infrastructure/api-client';
import type { ChatTokenUsage } from '@/lib/chat-usage';
import { guardPanelNavigation, navNoticeReducer } from '@/lib/panel-guard';
import { affectsSearch } from '@/lib/search-navigation';

interface DocumentPanelProps {
  page: PageItem | null;
  result: DocumentResult | null;
  isLoading: boolean;
  onClose: () => void;
  /**
   * Jen změněná pole dokumentu `documentId` (uložení, návrh z chatu a jeho
   * rollback, doběhlá retranslace) – ne celý snímek, který by vrátil změny
   * uložené mezitím, ani zápis do panelu s jiným dokumentem.
   */
  onResultPatch?: ResultPatchHandler;
  /**
   * Spotřeba odpovědi chatu k dokumentu `documentId`. Rodič ji má přičíst
   * funkčním updatem jen k panelu, který ten dokument pořád ukazuje
   * (`addChatUsageToDocument`) – uživatel mohl mezitím přepnout stránku.
   */
  onChatUsage?: (documentId: string, usage: ChatTokenUsage) => void;
  onPageUpdate?: (updated: PageItem) => void;
  onRegenerate?: (pageId: string) => void;
  isRegenerating?: boolean;
  regenerateStep?: string;
  regenerateProgress?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  highlightQuery?: string;
  /**
   * Hledání v titulkovém pruhu – sdílený výraz s hledáním ve workspace a listování
   * mezi stránkami se shodou. Zobrazí se i jen pro čtení: v cizím svazku, který
   * uživatel smí číst (sdílený workspace, veřejný), API hledá v jeho stránkách.
   */
  search?: PanelSearchProps;
  /** Uložený přepis/překlad (editor, chat, retranslace) – obnoví počty shod hledání. */
  onTextSaved?: () => void;
  /**
   * Cizí dokument – jen čtení: bez přejmenování, přegenerování/zpracování,
   * editace textů, obnovy verzí a chatu (stojí kredity a navrhuje úpravy).
   */
  readOnly?: boolean;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

function getDisplayTitle(page: PageItem | null, documentLabel: string): string {
  if (!page) return documentLabel;
  return page.displayName || cleanFilename(page.filename);
}

export function DocumentPanel({
  page,
  result,
  isLoading,
  onClose,
  onResultPatch,
  onChatUsage,
  onPageUpdate,
  onRegenerate,
  isRegenerating,
  regenerateStep,
  regenerateProgress,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  highlightQuery,
  search,
  onTextSaved,
  readOnly = false,
}: DocumentPanelProps): React.JSX.Element | null {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Otevřený editor textu – přepnutí stránky by rozepsaný text zahodilo
  const [editorOpen, setEditorOpen] = useState(false);
  // Hláška „nejdřív uložte nebo zrušte úpravu“ (počítadlo restartuje její časovač)
  const [navBlockedNotice, dispatchNavNotice] = useReducer(navNoticeReducer, 0);
  const t = useTranslations('document');
  const tc = useTranslations('common');

  useEffect(() => {
    setEditingTitle(false);
    dispatchNavNotice('page-changed');
  }, [page?.id]);

  // Po zavření editoru už hláška neplatí
  useEffect(() => {
    if (!editorOpen) dispatchNavNotice('editor-closed');
  }, [editorOpen]);

  useEffect(() => {
    if (navBlockedNotice === 0) return;
    const timer = setTimeout(() => dispatchNavNotice('timeout'), 4000);
    return () => clearTimeout(timer);
  }, [navBlockedNotice]);

  // Listování stránek z panelu (předchozí/další, shody hledání) s otevřeným
  // editorem neproběhne – jen krátká hláška.
  const guarded = useCallback(
    (navigate: (() => void) | undefined) => (): void => {
      guardPanelNavigation(
        editorOpen,
        () => navigate?.(),
        () => dispatchNavNotice('blocked'),
      );
    },
    [editorOpen],
  );
  const goPrevious = guarded(onPrevious);
  const goNext = guarded(onNext);

  // Zkratky panelu platí jen mimo pole – psaní do hledání (i šipky a Escape v něm)
  // stránky nepřepíná ani panel nezavře.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;

      // Ctrl/Cmd+F v panelu skočí do jeho hledání (ve workspace otevírá hledání
      // v liště). Z pole hledání ani z editoru textu ho nepřebírá – druhé Ctrl+F
      // otevře hledání prohlížeče.
      const searchInput = searchInputRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && searchInput && !isInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      if (e.key === 'Escape' && !isInput) onClose();
      if (!isInput && e.key === 'ArrowLeft' && hasPrevious) goPrevious();
      if (!isInput && e.key === 'ArrowRight' && hasNext) goNext();
    },
    [onClose, goPrevious, goNext, hasPrevious, hasNext],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleChatApplyUpdate = useCallback(
    (field: string, content: string): void => {
      if (!result) return;
      // Optimistický update + rollback při selhání PATCHe – jen měněné pole.
      // Rollback jen když panel pořád ukazuje tuto úpravu (uživatel mohl pole
      // mezitím upravit znovu, nebo přepnout stránku).
      const key = field as 'transcription' | 'translation' | 'context';
      const previousValue = result[key];
      const language =
        key === 'translation' ? { translationLanguage: result.translationLanguage } : {};
      onResultPatch?.(result.id, { [key]: content }, language);
      const rollback = (): void =>
        onResultPatch?.(
          result.id,
          { [key]: previousValue },
          { ...language, expected: { [key]: content } },
        );
      void (async () => {
        try {
          const res = await apiFetch(`/api/documents/${result.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              [field]: content,
              ...(field === 'translation'
                ? { translationLanguage: result.translationLanguage }
                : {}),
            }),
          });
          if (!res.ok) rollback();
          else if (affectsSearch(key)) onTextSaved?.();
        } catch {
          rollback();
        }
      })();
    },
    [result, onResultPatch, onTextSaved],
  );

  const handleTitleClick = useCallback((): void => {
    if (!page || readOnly) return;
    setTitleDraft(page.displayName || cleanFilename(page.filename));
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [page, readOnly]);

  const handleTitleSave = useCallback((): void => {
    if (!page) return;
    setEditingTitle(false);
    const newName = titleDraft.trim();
    const displayName = newName === cleanFilename(page.filename) ? null : newName || null;
    if (displayName === (page.displayName ?? null)) return;
    // Optimistický update + rollback při selhání PATCHe.
    const previous = page;
    onPageUpdate?.({ ...page, displayName });
    void (async () => {
      try {
        const res = await apiFetch(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName }),
        });
        if (!res.ok) onPageUpdate?.(previous);
      } catch {
        onPageUpdate?.(previous);
      }
    })();
  }, [page, titleDraft, onPageUpdate]);

  if (!page && !isLoading) return null;

  const status = page?.status ?? 'pending';
  const title = getDisplayTitle(page, t('document'));
  const canRegenerate = !readOnly && onRegenerate !== undefined;
  const showRegenerate = page && canRegenerate && (status === 'done' || status === 'error');

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />

      {/* Fullscreen panel */}
      <div className="fixed inset-4 z-40 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Toolbar – pod md hledání na druhém řádku, akce vpravo se nepřekrývají */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-800 px-4 py-2 md:flex-nowrap">
          {/* Left: navigation + title */}
          <div className="flex min-w-0 flex-1 basis-0 items-center gap-2 md:flex-initial md:basis-auto">
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={goPrevious}
                disabled={!hasPrevious}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                aria-label={tc('previous')}
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
                    d="M15.75 19.5 8.25 12l7.5-7.5"
                  />
                </svg>
              </button>
              <button
                onClick={goNext}
                disabled={!hasNext}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                aria-label={tc('next')}
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
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </button>
            </div>
            <div className="ml-1 min-w-[6rem]">
              {editingTitle && !readOnly ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSave();
                    if (e.key === 'Escape') setEditingTitle(false);
                    e.stopPropagation();
                  }}
                  className="w-48 max-w-full rounded bg-slate-700 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-slate-500 focus:ring-blue-400"
                />
              ) : readOnly ? (
                <h2 className="truncate text-sm font-semibold text-white" title={title}>
                  {title}
                </h2>
              ) : (
                <h2
                  className="cursor-text truncate text-sm font-semibold text-white hover:text-slate-200"
                  onClick={handleTitleClick}
                  title={t('clickToRename')}
                >
                  {title}
                </h2>
              )}
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                {status === 'done' && t('processed')}
                {status === 'pending' && t('pendingProcessing')}
                {status === 'processing' && t('processingInProgress')}
                {status === 'error' && t('processingError')}
                {readOnly && (
                  <span className="rounded bg-slate-700 px-1.5 py-px text-[10px] font-medium text-slate-300">
                    {t('readOnly')}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Search – vedle názvu, pod md na vlastním řádku. Na md+ se nezmenšuje
              (zmenšuje se jen titulek), jinak by se šipky dostaly pod akce vpravo
              a klik by místo listování spustil placené přegenerování. */}
          {search && (
            <div className="order-last flex w-full min-w-0 md:order-none md:w-auto md:shrink-0 md:border-l md:border-slate-700 md:pl-3">
              <PanelSearchBar
                ref={searchInputRef}
                {...search}
                onPrevious={guarded(search.onPrevious)}
                onNext={guarded(search.onNext)}
                pageId={page?.id ?? null}
                editorOpen={editorOpen}
              />
            </div>
          )}

          {/* Right: actions */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {showRegenerate && (
              <button
                onClick={() => onRegenerate?.(page.id)}
                disabled={isRegenerating}
                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50"
              >
                {isRegenerating ? (
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
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                    />
                  </svg>
                )}
                {isRegenerating ? t('regenerating') : t('regenerate')}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              aria-label={tc('close')}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Zablokované listování kvůli rozepsanému textu – oblast drží DOM pro čtečky */}
        <div role="status" aria-live="polite" className="shrink-0">
          {navBlockedNotice > 0 && (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
              {t('navigationBlockedByEdit')}
            </p>
          )}
        </div>

        {/* Content: image left (1/3), results + chat right (2/3) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: original image — full height */}
          {page && (
            <div className="flex w-1/3 flex-col border-r border-slate-200 bg-slate-50">
              <div className="shrink-0 border-b border-slate-100 px-4 py-2">
                <span className="text-xs font-medium text-slate-500">{t('original')}</span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <img src={page.imageUrl} alt={title} className="w-full rounded shadow-sm" />
              </div>
            </div>
          )}

          {/* Right: result content or status */}
          <div className="flex w-2/3 flex-col overflow-hidden">
            {isRegenerating || status === 'processing' ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-xs space-y-3 text-center">
                  <svg
                    className="mx-auto h-8 w-8 animate-spin text-blue-500"
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
                  <p className="text-sm text-slate-600">
                    {regenerateStep ?? t('processingDocument')}
                  </p>
                  {regenerateProgress != null && (
                    <div className="space-y-1">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${Math.min(regenerateProgress, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400">{regenerateProgress} %</p>
                    </div>
                  )}
                </div>
              </div>
            ) : isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-3 h-8 w-8 animate-spin text-slate-400"
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
                  <p className="text-sm text-slate-500">{tc('loading')}</p>
                </div>
              </div>
            ) : status === 'done' && result ? (
              <div className="flex flex-1 flex-col overflow-y-auto">
                <ResultViewer
                  result={result}
                  onPatch={onResultPatch}
                  highlightQuery={highlightQuery}
                  readOnly={readOnly}
                  onEditingChange={setEditorOpen}
                  onTextSaved={onTextSaved}
                />
                {/* Chat – stojí kredity a navrhuje úpravy; u cizího dokumentu ho API odmítne */}
                {!readOnly && (
                  <div className="border-t border-slate-200">
                    <DocumentChat
                      documentId={result.id}
                      currentFields={{
                        transcription: result.transcription,
                        translation: result.translation,
                        context: result.context,
                      }}
                      onApplyUpdate={handleChatApplyUpdate}
                      onTokenUsage={(usage) => {
                        // Skutečně odečtené kredity (a tokeny) odpovědi k souhrnu chatu –
                        // ne přes `onResultUpdate(addChatUsage(result, …))`: `result` je
                        // snímek z doby renderu a po přepnutí stránky by panel přepsal
                        // obsahem tohoto dokumentu.
                        onChatUsage?.(result.id, usage);
                      }}
                    />
                  </div>
                )}
              </div>
            ) : status === 'error' ? (
              <div className="p-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-red-700">
                    {t('processingError')}
                  </h3>
                  <p className="text-sm text-red-600">{page?.errorMessage ?? t('unknownError')}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="mb-4 text-sm text-slate-500">{t('notProcessedYet')}</p>
                {page && canRegenerate && (
                  <button
                    onClick={() => onRegenerate?.(page.id)}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {t('processButton')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
