'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/infrastructure/api-client';

export interface UploadedPage {
  id: string;
  filename: string;
  imageUrl: string;
  status: string;
  collectionId: string | null;
  hash: string;
  order: number;
  createdAt: string;
}

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPagesImported: (pages: UploadedPage[]) => void;
  collectionId?: string | null;
}

type Tab = 'files' | 'url';

interface FileStatus {
  file: File;
  state: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  preview?: string;
}

interface DiscoveredImage {
  url: string;
  label: string;
  thumbnailUrl: string;
  selected: boolean;
  state: 'pending' | 'importing' | 'done' | 'error';
  error?: string;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = 20;

export function ImportDialog({
  isOpen,
  onClose,
  onPagesImported,
  collectionId,
}: ImportDialogProps): React.JSX.Element | null {
  const t = useTranslations('importDialog');
  const [tab, setTab] = useState<Tab>('files');
  // Files tab
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // URL tab
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredImage[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isImportingDiscovered, setIsImportingDiscovered] = useState(false);
  const [hasMoreForward, setHasMoreForward] = useState(false);
  const [hasMoreBackward, setHasMoreBackward] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [forwardOffset, setForwardOffset] = useState(0);
  const [backwardOffset, setBackwardOffset] = useState(0);
  const [pageLimit, setPageLimit] = useState(20);

  useEffect(() => {
    if (isOpen) {
      setFileStatuses([]);
      setIsUploading(false);
      setIsDragOver(false);
      setUrlInput('');
      setUrlError(null);
      setUrlSuccess(null);
      setDiscovered([]);
      setHasMoreForward(false);
      setHasMoreBackward(false);
      setIsLoadingMore(false);
      setForwardOffset(0);
      setBackwardOffset(0);
    }
  }, [isOpen]);

  // ---- Files tab logic ----
  const validateFile = useCallback(
    (file: File): string | null => {
      if (!ALLOWED_TYPES.includes(file.type)) return t('unsupportedFormat');
      if (file.size > MAX_SIZE_MB * 1024 * 1024) return t('tooLarge', { max: MAX_SIZE_MB });
      return null;
    },
    [t],
  );

  const buildPreviews = useCallback(
    (files: File[]): Promise<FileStatus[]> =>
      Promise.all(
        files.map(
          (file) =>
            new Promise<FileStatus>((resolve) => {
              const error = validateFile(file);
              if (error) {
                resolve({ file, state: 'error', error });
                return;
              }
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) =>
                  resolve({ file, state: 'pending', preview: e.target?.result as string });
                reader.readAsDataURL(file);
              } else {
                resolve({ file, state: 'pending' });
              }
            }),
        ),
      ),
    [validateFile],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const statuses = await buildPreviews(files);
      setFileStatuses(statuses);
      setIsUploading(true);

      const validFiles = statuses.filter((s) => s.state !== 'error');
      if (validFiles.length === 0) {
        setIsUploading(false);
        return;
      }

      setFileStatuses((prev) =>
        prev.map((s) => (s.state === 'pending' ? { ...s, state: 'uploading' as const } : s)),
      );

      try {
        const formData = new FormData();
        for (const s of validFiles) formData.append('files', s.file);
        if (collectionId) formData.append('collectionId', collectionId);

        const response = await apiFetch('/api/pages/upload', { method: 'POST', body: formData });
        const data = (await response.json()) as {
          pages?: UploadedPage[];
          errors?: { filename: string; error: string }[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? t('uploadFailed'));

        const uploadedPages = data.pages ?? [];
        const uploadErrors = data.errors ?? [];

        setFileStatuses((prev) =>
          prev.map((s) => {
            const page = uploadedPages.find((p) => p.filename === s.file.name);
            if (page) return { ...s, state: 'done' as const };
            const err = uploadErrors.find((e) => e.filename === s.file.name);
            if (err) return { ...s, state: 'error' as const, error: err.error };
            return s;
          }),
        );

        if (uploadedPages.length > 0) onPagesImported(uploadedPages);
      } catch (err) {
        const message = err instanceof Error ? err.message : t('unknownError');
        setFileStatuses((prev) =>
          prev.map((s) =>
            s.state === 'uploading' ? { ...s, state: 'error' as const, error: message } : s,
          ),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [t, buildPreviews, collectionId, onPagesImported],
  );

  // ---- URL tab logic ----
  const importSingleUrl = useCallback(
    async (url: string, displayName?: string): Promise<UploadedPage | null> => {
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const res = await apiFetch('/api/pages/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, collectionId, displayName }),
        });
        // Retry on 500 (server overload) with exponential backoff
        if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        let data: { page?: UploadedPage; error?: string };
        try {
          data = (await res.json()) as { page?: UploadedPage; error?: string };
        } catch {
          throw new Error(t('serverError', { status: res.status }));
        }
        if (!res.ok) throw new Error(data.error ?? t('importFailed'));
        return (data.page as UploadedPage) ?? null;
      }
      throw new Error(t('importFailedRetry'));
    },
    [t, collectionId],
  );

  const discoverAbortRef = useRef<AbortController | null>(null);

  const pageLimitRef = useRef(pageLimit);
  pageLimitRef.current = pageLimit;

  const discoverRelated = useCallback(
    async (baseUrl: string, direction?: 'forward' | 'backward', offset?: number) => {
      // Abort any previous discovery
      discoverAbortRef.current?.abort();
      const abortController = new AbortController();
      discoverAbortRef.current = abortController;

      if (direction) {
        setIsLoadingMore(true);
        if (direction === 'forward') setHasMoreForward(false);
        else setHasMoreBackward(false);
      } else {
        setIsDiscovering(true);
        setHasMoreForward(false);
        setHasMoreBackward(false);
        setForwardOffset(0);
        setBackwardOffset(0);
      }
      try {
        const res = await apiFetch('/api/pages/discover-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: baseUrl,
            direction: direction ?? 'both',
            limit: pageLimitRef.current,
            ...(offset ? { offset } : {}),
          }),
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const prefetchBatch: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6)) as {
              type: string;
              url?: string;
              label?: string;
              thumbnailUrl?: string;
              forward?: boolean;
              backward?: boolean;
              forwardTotal?: number;
              backwardTotal?: number;
            };

            if (data.type === 'source' && data.label && data.thumbnailUrl) {
              setDiscovered((prev) =>
                prev.map((d, i) =>
                  i === 0 ? { ...d, label: data.label!, thumbnailUrl: data.thumbnailUrl! } : d,
                ),
              );
            } else if (data.type === 'found' && data.url && data.label && data.thumbnailUrl) {
              prefetchBatch.push(data.url);
              // Trigger prefetch every 10 URLs
              if (prefetchBatch.length >= 10) {
                void apiFetch('/api/pages/prefetch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ urls: prefetchBatch.splice(0) }),
                });
              }
              setDiscovered((prev) => {
                if (prev.some((d) => d.url === data.url)) return prev;
                return [
                  ...prev,
                  {
                    url: data.url!,
                    label: data.label!,
                    thumbnailUrl: data.thumbnailUrl!,
                    selected: true,
                    state: 'pending' as const,
                  },
                ];
              });
            } else if (data.type === 'has_more') {
              if (!direction || direction === 'forward') {
                setHasMoreForward(data.forward ?? false);
                if (data.forwardTotal != null) setForwardOffset(data.forwardTotal);
              }
              if (!direction || direction === 'backward') {
                setHasMoreBackward(data.backward ?? false);
                if (data.backwardTotal != null) setBackwardOffset(data.backwardTotal);
              }
            }
          }
        }
        // Flush remaining prefetch batch
        if (prefetchBatch.length > 0) {
          void apiFetch('/api/pages/prefetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: prefetchBatch.splice(0) }),
          });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // Discovery is best-effort
      } finally {
        setIsDiscovering(false);
        setIsLoadingMore(false);
      }
    },
    [],
  );

  // Trigger discovery as soon as URL is entered (debounced)
  const discoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (discoverTimeoutRef.current) clearTimeout(discoverTimeoutRef.current);
    discoverAbortRef.current?.abort();
    setDiscovered([]);
    setIsDiscovering(false);
    const url = urlInput.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    // Extract a reasonable label — for query-param URLs use the numeric value
    let enteredFilename: string;
    try {
      const parsed = new URL(url);
      let queryId: string | null = null;
      for (const [key, value] of parsed.searchParams) {
        if (/^\d+$/.test(value) && value.length >= 2) {
          queryId = `${key}=${value}`;
          break;
        }
      }
      enteredFilename =
        queryId ?? decodeURIComponent(parsed.pathname.split('/').pop() ?? 'unknown');
    } catch {
      enteredFilename = decodeURIComponent(url.split('/').pop() ?? 'unknown');
    }
    setDiscovered([
      { url, label: enteredFilename, thumbnailUrl: url, selected: true, state: 'pending' },
    ]);
    discoverTimeoutRef.current = setTimeout(() => {
      void discoverRelated(url);
    }, 500);
    return () => {
      if (discoverTimeoutRef.current) clearTimeout(discoverTimeoutRef.current);
      discoverAbortRef.current?.abort();
    };
  }, [urlInput, discoverRelated]);

  const handleImportDiscovered = useCallback(async () => {
    const toImport = discovered.filter((d) => d.selected && d.state === 'pending');
    if (toImport.length === 0 || isImportingDiscovered) return;
    setIsImportingDiscovered(true);

    // Mark all as importing at once
    const importingUrls = new Set(toImport.map((d) => d.url));
    setDiscovered((prev) =>
      prev.map((d) =>
        importingUrls.has(d.url) && d.state === 'pending'
          ? { ...d, state: 'importing' as const }
          : d,
      ),
    );

    const CONCURRENCY = 3;

    // Process in parallel batches
    for (let i = 0; i < toImport.length; i += CONCURRENCY) {
      const batch = toImport.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const page = await importSingleUrl(item.url, item.label);
          setDiscovered((prev) =>
            prev.map((d) => (d.url === item.url ? { ...d, state: 'done' as const } : d)),
          );
          return { url: item.url, page };
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        if (result.status !== 'fulfilled') {
          const item = batch[j]!;
          const message = result.reason instanceof Error ? result.reason.message : t('error');
          setDiscovered((prev) =>
            prev.map((d) =>
              d.url === item.url ? { ...d, state: 'error' as const, error: message } : d,
            ),
          );
        }
      }
      // Report batch progress
      const batchImported = results
        .filter(
          (r): r is PromiseFulfilledResult<{ url: string; page: UploadedPage | null }> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value.page)
        .filter((p): p is UploadedPage => p !== null);
      if (batchImported.length > 0) onPagesImported(batchImported);
    }

    setIsImportingDiscovered(false);
  }, [discovered, isImportingDiscovered, importSingleUrl, onPagesImported]);

  if (!isOpen) return null;

  const allFilesDone =
    fileStatuses.length > 0 && fileStatuses.every((s) => s.state === 'done' || s.state === 'error');
  const doneCount = fileStatuses.filter((s) => s.state === 'done').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        {/* Header with tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-slate-800">{t('title')}</h2>
            <div className="flex gap-0">
              <button
                onClick={() => setTab('files')}
                className={`rounded-t px-3 py-1 text-sm font-medium transition-colors ${
                  tab === 'files'
                    ? 'border-b-2 border-slate-800 text-slate-800'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t('tabFiles')}
              </button>
              <button
                onClick={() => setTab('url')}
                className={`rounded-t px-3 py-1 text-sm font-medium transition-colors ${
                  tab === 'url'
                    ? 'border-b-2 border-slate-800 text-slate-800'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t('tabUrl')}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
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

        {/* Body */}
        <div className="p-6 space-y-4">
          {tab === 'files' && (
            <>
              {/* Drop zone */}
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files.length > 0)
                    void uploadFiles(Array.from(e.dataTransfer.files));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onClick={() => !isUploading && inputRef.current?.click()}
                className={[
                  'flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                  isDragOver
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
                  isUploading ? 'pointer-events-none opacity-60' : '',
                ].join(' ')}
              >
                <svg
                  className="mb-3 h-10 w-10 text-slate-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                {isUploading ? (
                  <p className="text-slate-600">{t('uploading')}</p>
                ) : allFilesDone ? (
                  <div>
                    <p className="font-medium text-green-700">
                      {t('uploadDone', { count: doneCount })}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">{t('uploadMore')}</p>
                  </div>
                ) : (
                  <>
                    <p className="text-slate-600">{t('dropZoneText')}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {t('dropZoneFormats', { max: MAX_SIZE_MB })}
                    </p>
                  </>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED_TYPES.join(',')}
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(Array.from(e.target.files));
                }}
                className="sr-only"
              />

              {/* File list */}
              {fileStatuses.length > 0 && (
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {fileStatuses.map((s, i) => (
                    <FileStatusRow key={i} status={s} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'url' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">{t('urlLabel')}</label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setUrlError(null);
                    setUrlSuccess(null);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={t('urlPlaceholder')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
                {urlError && <p className="text-sm text-red-600">{urlError}</p>}
                {urlSuccess && <p className="text-sm text-green-600">{urlSuccess}</p>}
              </div>

              {/* Discovered related pages */}
              {isDiscovering && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                  {t('searchingPages')}
                  <button
                    onClick={() => discoverAbortRef.current?.abort()}
                    className="ml-2 rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {t('stopDiscovery')}
                  </button>
                </div>
              )}

              {discovered.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">
                      {t('foundPages', { count: discovered.length })}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setDiscovered((prev) => prev.map((d) => ({ ...d, selected: true })))
                        }
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t('selectAll')}
                      </button>
                      <button
                        onClick={() =>
                          setDiscovered((prev) => prev.map((d) => ({ ...d, selected: false })))
                        }
                        className="text-xs text-slate-400 hover:underline"
                      >
                        {t('selectNone')}
                      </button>
                    </div>
                  </div>
                  <div className="grid max-h-96 grid-cols-5 gap-2 overflow-y-auto">
                    {discovered.map((d) => (
                      <button
                        key={d.url}
                        onClick={() =>
                          d.state === 'pending' &&
                          setDiscovered((prev) =>
                            prev.map((x) =>
                              x.url === d.url ? { ...x, selected: !x.selected } : x,
                            ),
                          )
                        }
                        disabled={d.state !== 'pending'}
                        className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
                          d.state === 'done'
                            ? 'border-green-400 opacity-60'
                            : d.state === 'error'
                              ? 'border-red-300 opacity-60'
                              : d.selected
                                ? 'border-blue-500 ring-1 ring-blue-300'
                                : 'border-slate-200 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={d.thumbnailUrl}
                          alt={d.label}
                          className="aspect-[3/4] w-full object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1">
                          <span className="text-[10px] font-bold text-white">{d.label}</span>
                        </div>
                        {d.state === 'pending' && d.selected && (
                          <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
                            <svg
                              className="h-2.5 w-2.5 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m4.5 12.75 6 6 9-13.5"
                              />
                            </svg>
                          </div>
                        )}
                        {d.state === 'importing' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <svg
                              className="h-5 w-5 animate-spin text-white"
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
                          </div>
                        )}
                        {d.state === 'done' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-green-500/20">
                            <svg
                              className="h-6 w-6 text-green-600"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m4.5 12.75 6 6 9-13.5"
                              />
                            </svg>
                          </div>
                        )}
                        {d.state === 'error' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                            <span className="rounded bg-red-600 px-1 text-[9px] text-white">
                              {t('error')}
                            </span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  {/* Pagination buttons */}
                  {(hasMoreBackward || hasMoreForward) && !isDiscovering && (
                    <div className="flex items-center justify-center gap-2">
                      {hasMoreBackward && (
                        <button
                          onClick={() => {
                            const url = urlInput.trim();
                            if (url) void discoverRelated(url, 'backward', backwardOffset);
                          }}
                          disabled={isLoadingMore}
                          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <svg
                            className="h-3 w-3"
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
                          {isLoadingMore ? t('loading') : t('loadPrevious')}
                        </button>
                      )}
                      <select
                        value={pageLimit}
                        onChange={(e) => setPageLimit(Number(e.target.value))}
                        className="rounded border border-slate-300 px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-blue-400"
                      >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={500}>500</option>
                      </select>
                      {hasMoreForward && (
                        <button
                          onClick={() => {
                            const url = urlInput.trim();
                            if (url) void discoverRelated(url, 'forward', forwardOffset);
                          }}
                          disabled={isLoadingMore}
                          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {isLoadingMore ? t('loading') : t('loadNext')}
                          <svg
                            className="h-3 w-3"
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
                      )}
                    </div>
                  )}

                  {discovered.some((d) => d.selected && d.state === 'pending') && (
                    <button
                      onClick={() => void handleImportDiscovered()}
                      disabled={isImportingDiscovered}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isImportingDiscovered
                        ? t('importing')
                        : t('importSelected', {
                            count: discovered.filter((d) => d.selected && d.state === 'pending')
                              .length,
                          })}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileStatusRow({ status: s }: { status: FileStatus }): React.JSX.Element {
  const t = useTranslations('importDialog');
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
      {s.preview && (
        <img src={s.preview} alt={s.file.name} className="h-8 w-8 rounded object-cover" />
      )}
      <span className="flex-1 truncate text-slate-700">{s.file.name}</span>
      {s.state === 'uploading' && (
        <svg className="h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
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
      )}
      {s.state === 'done' && (
        <svg
          className="h-4 w-4 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      )}
      {s.state === 'error' && <span className="text-xs text-red-500">{s.error ?? t('error')}</span>}
    </div>
  );
}
