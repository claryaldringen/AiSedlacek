'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PageItem } from '@/components/FileGrid';
import type { Collection } from '@/components/Sidebar';

interface UseProcessingJobOptions {
  pages: PageItem[];
  setPages: React.Dispatch<React.SetStateAction<PageItem[]>>;
  selected: Set<string>;
  collections: Collection[];
  loadingPages: boolean;
}

interface UseProcessingJobReturn {
  processingPageIds: Set<string>;
  processingStep: string | undefined;
  processingProgress: number | undefined;
  isProcessing: boolean;
  handleProcessSelected: () => Promise<void>;
  handleCancelProcessing: () => Promise<void>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  error: string | null;
}

interface JobStatusResponse {
  jobId: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  totalPages: number;
  completedPages: number;
  currentPageId: string | null;
  currentStep: string | null;
  errors: string[];
  pageIds: string[];
  progress: number;
  donePages: string[];
  errorPages: string[];
}

export function useProcessingJob({
  pages,
  setPages,
  selected,
  collections,
  loadingPages,
}: UseProcessingJobOptions): UseProcessingJobReturn {
  const [processingPageIds, setProcessingPageIds] = useState<Set<string>>(new Set());
  const [processingStep, setProcessingStep] = useState<string | undefined>(undefined);
  const [processingProgress, setProcessingProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Track which pages have already been refreshed to avoid duplicate fetches
  const refreshedPagesRef = useRef<Set<string>>(new Set());

  /** Stop polling interval */
  const stopPolling = useCallback((): void => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  /** Refresh a single page from the API */
  const refreshPage = useCallback(
    async (pageId: string): Promise<void> => {
      try {
        const res = await fetch(`/api/pages/${pageId}`);
        if (res.ok) {
          const updated = (await res.json()) as PageItem;
          setPages((prev) => prev.map((p) => (p.id === pageId ? updated : p)));
        }
      } catch {
        // ignore
      }
    },
    [setPages],
  );

  /** Poll job status and update UI state */
  const pollJobStatus = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/pages/process/status?jobId=${jobId}`);
        if (!res.ok) {
          // Job not found or error — stop polling
          return true;
        }

        const data = (await res.json()) as JobStatusResponse;

        setProcessingStep(data.currentStep ?? undefined);
        setProcessingProgress(data.progress);

        // Update page statuses for newly done pages
        for (const donePageId of data.donePages) {
          if (!refreshedPagesRef.current.has(donePageId)) {
            refreshedPagesRef.current.add(donePageId);
            // Remove from processing set
            setProcessingPageIds((prev) => {
              const next = new Set(prev);
              next.delete(donePageId);
              return next;
            });
            // Refresh page data
            void refreshPage(donePageId);
          }
        }

        // Update page statuses for error pages
        for (const errorPageId of data.errorPages) {
          if (!refreshedPagesRef.current.has(errorPageId)) {
            refreshedPagesRef.current.add(errorPageId);
            setProcessingPageIds((prev) => {
              const next = new Set(prev);
              next.delete(errorPageId);
              return next;
            });
            setPages((prev) =>
              prev.map((p) => (p.id === errorPageId ? { ...p, status: 'error' } : p)),
            );
          }
        }

        // Check for terminal states
        if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
          if (data.status === 'completed') {
            setProcessingStep('Hotovo');
            setProcessingProgress(100);
          } else if (data.status === 'cancelled') {
            setProcessingStep('Zrušeno');
            setProcessingProgress(undefined);
            // Reset any remaining processing pages in local state
            setPages((prev) =>
              prev.map((p) =>
                data.pageIds.includes(p.id) && p.status === 'processing'
                  ? { ...p, status: 'pending' }
                  : p,
              ),
            );
          } else if (data.status === 'error') {
            const errorMsg = data.errors.length > 0 ? data.errors.join('; ') : 'Chyba zpracování';
            setError(errorMsg);
            setProcessingStep('Chyba');
          }

          // Refresh all remaining pages that might have changed
          for (const pageId of data.pageIds) {
            if (!refreshedPagesRef.current.has(pageId)) {
              void refreshPage(pageId);
            }
          }

          return true; // Signal to stop polling
        }

        return false; // Continue polling
      } catch {
        // Network error — continue polling
        return false;
      }
    },
    [setPages, refreshPage],
  );

  /** Start polling for a job */
  const startPolling = useCallback(
    (jobId: string): void => {
      stopPolling();
      refreshedPagesRef.current = new Set();
      pollingRef.current = setInterval(async () => {
        const shouldStop = await pollJobStatus(jobId);
        if (shouldStop) {
          stopPolling();
          setActiveJobId(null);
          // Clear processing state after a delay
          setTimeout(() => {
            setProcessingPageIds(new Set());
            setProcessingStep(undefined);
            setProcessingProgress(undefined);
          }, 2000);
        }
      }, 2000);
    },
    [stopPolling, pollJobStatus],
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  /** Start processing selected pages */
  const handleProcessSelected = useCallback(async (): Promise<void> => {
    // Expand selected collections into their page IDs
    const selectedIds = Array.from(selected);
    const collectionIds = new Set(collections.map((c) => c.id));
    const expandedPageIds = new Set<string>();
    const knownPages = new Map(pages.map((p) => [p.id, p]));

    for (const id of selectedIds) {
      if (collectionIds.has(id)) {
        try {
          const res = await fetch(`/api/collections/${id}`);
          if (res.ok) {
            const col = (await res.json()) as { pages: PageItem[] };
            for (const p of col.pages) {
              expandedPageIds.add(p.id);
              knownPages.set(p.id, p);
            }
          }
        } catch {
          // ignore
        }
      } else {
        expandedPageIds.add(id);
      }
    }

    const pageIds = Array.from(expandedPageIds).filter((id) => {
      const p = knownPages.get(id);
      return p && (p.status === 'pending' || p.status === 'error');
    });
    if (pageIds.length === 0) return;

    setProcessingPageIds(new Set(pageIds));
    setProcessingStep('Spouštím zpracování…');
    setProcessingProgress(0);
    setError(null);

    setPages((prev) =>
      prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'processing' } : p)),
    );

    try {
      const response = await fetch('/api/pages/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, language: 'cs', mode: 'transcribe+translate' }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string; jobId?: string };
        // If there's already a running job, start polling it
        if (response.status === 409 && data.jobId) {
          setActiveJobId(data.jobId);
          startPolling(data.jobId);
          return;
        }
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const data = (await response.json()) as { jobId: string };
      setActiveJobId(data.jobId);

      // Start polling for job status
      startPolling(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
      setProcessingPageIds(new Set());
      setProcessingStep(undefined);
      setProcessingProgress(undefined);
      // Reset page statuses
      setPages((prev) =>
        prev.map((p) =>
          pageIds.includes(p.id) && p.status === 'processing' ? { ...p, status: 'pending' } : p,
        ),
      );
    }
  }, [selected, pages, collections, setPages, startPolling]);

  /** Cancel the current processing job */
  const handleCancelProcessing = useCallback(async (): Promise<void> => {
    if (!activeJobId) {
      // Try the legacy cancel endpoint as fallback
      try {
        await fetch('/api/pages/process/cancel', { method: 'POST' });
      } catch {
        // ignore
      }
      return;
    }

    try {
      await fetch('/api/pages/process/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: activeJobId, action: 'cancel' }),
      });
    } catch {
      // ignore
    }
  }, [activeJobId]);

  // ---- Reconnect to running job on page load ----
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (loadingPages || reconnectedRef.current) return;
    reconnectedRef.current = true;

    const checkForRunningJob = async (): Promise<void> => {
      try {
        const res = await fetch('/api/pages/process');
        if (!res.ok) return;

        const data = (await res.json()) as {
          status: string;
          jobId?: string;
          totalPages?: number;
          completedPages?: number;
          currentStep?: string;
        };

        if (data.status === 'running' && data.jobId) {
          // There's an active job — start monitoring it
          const processingPages = pagesRef.current.filter((p) => p.status === 'processing');
          setProcessingPageIds(new Set(processingPages.map((p) => p.id)));
          setProcessingStep(data.currentStep ?? 'Zpracovávám…');
          setProcessingProgress(
            data.totalPages && data.totalPages > 0
              ? Math.round(((data.completedPages ?? 0) / data.totalPages) * 100)
              : 0,
          );
          setActiveJobId(data.jobId);
          startPolling(data.jobId);
        } else if (data.status === 'idle') {
          // No active job — refresh any stuck "processing" pages
          const processingPages = pagesRef.current.filter((p) => p.status === 'processing');
          for (const p of processingPages) {
            void refreshPage(p.id);
          }
        }
      } catch {
        // ignore reconnection errors
      }
    };
    void checkForRunningJob();
  }, [loadingPages, startPolling, refreshPage]);

  const isProcessing = processingPageIds.size > 0;

  return {
    processingPageIds,
    processingStep,
    processingProgress,
    isProcessing,
    handleProcessSelected,
    handleCancelProcessing,
    setError,
    error,
  };
}
