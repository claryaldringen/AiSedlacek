'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ResultViewer, type DocumentResult } from './ResultViewer';
import { DocumentChat } from './DocumentChat';
import type { PageItem } from './FileGrid';

interface DocumentPanelProps {
  page: PageItem | null;
  result: DocumentResult | null;
  isLoading: boolean;
  onClose: () => void;
  onResultUpdate?: (updated: DocumentResult) => void;
  onPageUpdate?: (updated: PageItem) => void;
  onRegenerate?: (pageId: string) => void;
  isRegenerating?: boolean;
  regenerateStep?: string;
  regenerateProgress?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

function getDisplayTitle(page: PageItem | null): string {
  if (!page) return 'Dokument';
  return page.displayName || cleanFilename(page.filename);
}

export function DocumentPanel({
  page,
  result,
  isLoading,
  onClose,
  onResultUpdate,
  onPageUpdate,
  onRegenerate,
  isRegenerating,
  regenerateStep,
  regenerateProgress,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: DocumentPanelProps): React.JSX.Element | null {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditingTitle(false);
  }, [page?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;

      if (e.key === 'Escape' && !isInput) onClose();
      if (!isInput && e.key === 'ArrowLeft' && hasPrevious) onPrevious?.();
      if (!isInput && e.key === 'ArrowRight' && hasNext) onNext?.();
    },
    [onClose, onPrevious, onNext, hasPrevious, hasNext],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleChatApplyUpdate = useCallback(
    (field: string, content: string): void => {
      if (!result) return;
      void fetch(`/api/documents/${result.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [field]: content,
          ...(field === 'translation' ? { translationLanguage: result.translationLanguage } : {}),
        }),
      });
      const updated = { ...result, [field]: content };
      onResultUpdate?.(updated);
    },
    [result, onResultUpdate],
  );

  const handleTitleClick = useCallback((): void => {
    if (!page) return;
    setTitleDraft(page.displayName || cleanFilename(page.filename));
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [page]);

  const handleTitleSave = useCallback((): void => {
    if (!page) return;
    setEditingTitle(false);
    const newName = titleDraft.trim();
    const displayName = newName === cleanFilename(page.filename) ? null : newName || null;
    if (displayName === (page.displayName ?? null)) return;
    void fetch(`/api/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    const updated = { ...page, displayName };
    onPageUpdate?.(updated);
  }, [page, titleDraft, onPageUpdate]);

  if (!page && !isLoading) return null;

  const status = page?.status ?? 'pending';
  const title = getDisplayTitle(page);
  const showRegenerate = page && onRegenerate && (status === 'done' || status === 'error');

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />

      {/* Fullscreen panel */}
      <div className="fixed inset-4 z-40 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-800 px-4 py-2">
          {/* Left: navigation + title */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <button
                onClick={onPrevious}
                disabled={!hasPrevious}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                aria-label="Předchozí"
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
                onClick={onNext}
                disabled={!hasNext}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                aria-label="Další"
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
            <div className="ml-1">
              {editingTitle ? (
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
                  className="w-48 rounded bg-slate-700 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-slate-500 focus:ring-blue-400"
                />
              ) : (
                <h2
                  className="cursor-text text-sm font-semibold text-white hover:text-slate-200"
                  onClick={handleTitleClick}
                  title="Klikněte pro přejmenování"
                >
                  {title}
                </h2>
              )}
              <p className="text-xs text-slate-400">
                {status === 'done' && 'Zpracováno'}
                {status === 'pending' && 'Čeká na zpracování'}
                {status === 'processing' && 'Zpracovává se…'}
                {status === 'error' && 'Chyba zpracování'}
              </p>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1">
            {showRegenerate && (
              <button
                onClick={() => onRegenerate(page.id)}
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
                {isRegenerating ? 'Generuji…' : 'Přegenerovat'}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              aria-label="Zavřít"
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

        {/* Content: image left (1/3), results + chat right (2/3) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: original image — full height */}
          {page && (
            <div className="flex w-1/3 flex-col border-r border-slate-200 bg-slate-50">
              <div className="shrink-0 border-b border-slate-100 px-4 py-2">
                <span className="text-xs font-medium text-slate-500">Originál</span>
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
                    {regenerateStep ?? 'Zpracovávám dokument…'}
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
                  <p className="text-sm text-slate-500">Načítám…</p>
                </div>
              </div>
            ) : status === 'done' && result ? (
              <div className="flex flex-1 flex-col overflow-y-auto">
                <ResultViewer result={result} onUpdate={onResultUpdate} />
                {/* Chat */}
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
                      onResultUpdate?.({
                        ...result,
                        chatInputTokens: (result.chatInputTokens ?? 0) + usage.inputTokens,
                        chatOutputTokens: (result.chatOutputTokens ?? 0) + usage.outputTokens,
                        chatModel: usage.model,
                      });
                    }}
                  />
                </div>
              </div>
            ) : status === 'error' ? (
              <div className="p-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-red-700">Chyba zpracování</h3>
                  <p className="text-sm text-red-600">
                    {page?.errorMessage ?? 'Při zpracování dokumentu došlo k neznámé chybě.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="mb-4 text-sm text-slate-500">Dokument zatím nebyl zpracován.</p>
                {page && onRegenerate && (
                  <button
                    onClick={() => onRegenerate(page.id)}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Zpracovat
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
