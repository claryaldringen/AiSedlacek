'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PageItem } from '@/components/FileGrid';
import type { Collection } from '@/components/Sidebar';

interface UseProcessingStreamOptions {
  pages: PageItem[];
  setPages: React.Dispatch<React.SetStateAction<PageItem[]>>;
  selected: Set<string>;
  collections: Collection[];
  processingMode: 'transcribe+translate' | 'translate';
  loadingPages: boolean;
}

interface UseProcessingStreamReturn {
  processingPageIds: Set<string>;
  processingStep: string | undefined;
  processingProgress: number | undefined;
  isPaused: boolean;
  interruptedPages: string[];
  isProcessing: boolean;
  handleProcessSelected: () => Promise<void>;
  handleCancelProcessing: () => Promise<void>;
  handlePauseProcessing: () => Promise<void>;
  handleResumeProcessing: () => Promise<void>;
  handleResumeInterrupted: () => Promise<void>;
  handleResetInterrupted: () => Promise<void>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  error: string | null;
}

export function useProcessingStream({
  pages,
  setPages,
  selected,
  collections,
  processingMode,
  loadingPages,
}: UseProcessingStreamOptions): UseProcessingStreamReturn {
  const [processingPageIds, setProcessingPageIds] = useState<Set<string>>(new Set());
  const [processingStep, setProcessingStep] = useState<string | undefined>(undefined);
  const [processingProgress, setProcessingProgress] = useState<number | undefined>(undefined);
  const [batchInfo, setBatchInfo] = useState<{
    batchNumber: number;
    totalBatches: number;
    pageCount: number;
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [interruptedPages, setInterruptedPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const batchInfoRef = useRef(batchInfo);
  batchInfoRef.current = batchInfo;

  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  /** Read an SSE stream from a Response and dispatch events to state. */
  const consumeProcessingStream = useCallback(async (response: Response): Promise<void> => {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let receivedDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const eventStr of events) {
        const match = eventStr.match(/^event: (\w+)\ndata: (.+)$/s);
        if (!match) continue;
        const eventType = match[1];
        const dataStr = match[2];
        if (!eventType || !dataStr) continue;

        if (eventType === 'page_progress') {
          const data = JSON.parse(dataStr) as {
            pageId: string;
            message: string;
            progress: number;
          };
          const bi = batchInfoRef.current;
          const batchPrefix =
            bi && bi.totalBatches > 1 ? `Dávka ${bi.batchNumber}/${bi.totalBatches} — ` : '';
          setProcessingStep(batchPrefix + data.message);
          setProcessingProgress(data.progress);
        } else if (eventType === 'page_done') {
          const data = JSON.parse(dataStr) as {
            pageId: string;
            documentId: string;
            cached: boolean;
            progress: number;
          };
          setProcessingProgress(data.progress);
          setProcessingPageIds((prev) => {
            const next = new Set(prev);
            next.delete(data.pageId);
            return next;
          });
          setPages((prev) =>
            prev.map((p) => (p.id === data.pageId ? { ...p, status: 'done' } : p)),
          );
          void (async () => {
            try {
              const res = await fetch(`/api/pages/${data.pageId}`);
              if (res.ok) {
                const updated = (await res.json()) as PageItem;
                setPages((prev) => prev.map((p) => (p.id === data.pageId ? updated : p)));
              }
            } catch {
              // ignore
            }
          })();
        } else if (eventType === 'page_skipped') {
          const data = JSON.parse(dataStr) as { pageId: string; progress: number };
          setProcessingProgress(data.progress);
          setProcessingPageIds((prev) => {
            const next = new Set(prev);
            next.delete(data.pageId);
            return next;
          });
        } else if (eventType === 'page_error') {
          const data = JSON.parse(dataStr) as {
            pageId: string;
            error: string;
            progress: number;
          };
          setProcessingPageIds((prev) => {
            const next = new Set(prev);
            next.delete(data.pageId);
            return next;
          });
          setPages((prev) =>
            prev.map((p) => (p.id === data.pageId ? { ...p, status: 'error' } : p)),
          );
        } else if (eventType === 'batch_info') {
          const data = JSON.parse(dataStr) as {
            batchNumber: number;
            totalBatches: number;
            pageCount: number;
          };
          setBatchInfo(data);
          batchInfoRef.current = data;
        } else if (eventType === 'batch_progress') {
          const data = JSON.parse(dataStr) as {
            batchNumber: number;
            message?: string;
            outputTokens?: number;
            estimatedTotal?: number;
            progress?: number;
          };
          const bi = batchInfoRef.current;
          const totalBatches = bi?.totalBatches ?? '?';
          if (data.message) {
            setProcessingStep(`Dávka ${data.batchNumber}/${totalBatches} — ${data.message}`);
          }
          if (data.progress != null) {
            setProcessingProgress(data.progress);
          } else if (data.outputTokens != null && data.estimatedTotal) {
            setProcessingProgress(Math.round((data.outputTokens / data.estimatedTotal) * 100));
          }
        } else if (eventType === 'done') {
          receivedDone = true;
          setBatchInfo(null);
          batchInfoRef.current = null;
          setProcessingStep('Hotovo');
          setProcessingProgress(100);
        } else if (eventType === 'cancelled') {
          setBatchInfo(null);
          batchInfoRef.current = null;
          setProcessingStep('Zrušeno');
          setProcessingProgress(undefined);
        } else if (eventType === 'paused') {
          const data = JSON.parse(dataStr) as { message: string; progress: number };
          setProcessingStep(data.message);
          setProcessingProgress(data.progress);
          setIsPaused(true);
        } else if (eventType === 'resumed') {
          const data = JSON.parse(dataStr) as { message: string; progress: number };
          setProcessingStep(data.message);
          setProcessingProgress(data.progress);
          setIsPaused(false);
        }
      }
    }

    // Stream ended — check if it was graceful (received 'done' event) or abrupt (timeout/error)
    if (!receivedDone) {
      setError('Spojení se serverem bylo přerušeno. Některé stránky nebyly zpracovány.');
      setProcessingStep('Přerušeno');
      setProcessingProgress(undefined);
      // Reset pages still in 'processing' back to 'pending' so user can retry
      setPages((prev) =>
        prev.map((p) => (p.status === 'processing' ? { ...p, status: 'pending' } : p)),
      );
      // Also reset on server
      void fetch('/api/pages/process/interrupted', { method: 'POST' }).catch(() => {});
    }
  }, [setPages]);

  const handleProcessSelected = useCallback(async (): Promise<void> => {
    // Expand selected collections into their page IDs
    const selectedIds = Array.from(selected);
    const collectionIds = new Set(collections.map((c) => c.id));
    const expandedPageIds = new Set<string>();
    // Track pages we already know about locally
    const knownPages = new Map(pages.map((p) => [p.id, p]));

    for (const id of selectedIds) {
      if (collectionIds.has(id)) {
        // Fetch pages for this collection (they may not be in `pages` array in root view)
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
        body: JSON.stringify({ pageIds, language: 'cs', mode: processingMode }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      await consumeProcessingStream(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setProcessingPageIds(new Set());
      setIsPaused(false);
      setBatchInfo(null);
      batchInfoRef.current = null;
      setTimeout(() => {
        setProcessingStep(undefined);
        setProcessingProgress(undefined);
      }, 2000);
    }
  }, [selected, pages, collections, processingMode, consumeProcessingStream, setPages]);

  /** Reconnect to an already-running processing job (e.g. after page refresh). */
  const hasProcessingPages = pages.some((p) => p.status === 'processing');
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (!hasProcessingPages) {
      reconnectedRef.current = false;
      return;
    }
    // Don't reconnect if we're already tracking a job or already reconnected
    if (reconnectedRef.current) return;
    reconnectedRef.current = true;

    const reconnect = async (): Promise<void> => {
      const processingPages = pagesRef.current.filter((p) => p.status === 'processing');
      try {
        const response = await fetch('/api/pages/process');

        // If server returns JSON (no active job), the pages are stale — reload them
        const ct = response.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          // No active job — pages stuck in 'processing' need a status refresh
          for (const p of processingPages) {
            try {
              const res = await fetch(`/api/pages/${p.id}`);
              if (res.ok) {
                const updated = (await res.json()) as PageItem;
                setPages((prev) => prev.map((pg) => (pg.id === p.id ? updated : pg)));
              }
            } catch {
              // ignore
            }
          }
          return;
        }

        // Active job found — resume monitoring
        setProcessingPageIds(new Set(processingPages.map((p) => p.id)));
        setProcessingStep('Zpracovávám…');
        setProcessingProgress(0);

        await consumeProcessingStream(response);

        setProcessingPageIds(new Set());
        setIsPaused(false);
        setBatchInfo(null);
        batchInfoRef.current = null;
        setTimeout(() => {
          setProcessingStep(undefined);
          setProcessingProgress(undefined);
        }, 2000);
      } catch {
        // ignore reconnection errors
      }
    };
    void reconnect();
  }, [hasProcessingPages, consumeProcessingStream, setPages]);

  // ---- Detect interrupted (orphaned) processing pages on load ----
  useEffect(() => {
    if (loadingPages) return;
    const checkInterrupted = async (): Promise<void> => {
      try {
        const res = await fetch('/api/pages/process/interrupted');
        if (!res.ok) return;
        const data = (await res.json()) as { count: number; pageIds: string[] };
        setInterruptedPages(data.pageIds);
      } catch {
        // ignore
      }
    };
    void checkInterrupted();
  }, [loadingPages]);

  const handleCancelProcessing = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/pages/process/cancel', { method: 'POST' });
    } catch {
      // ignore
    }
  }, []);

  const handlePauseProcessing = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/pages/process/pause', { method: 'POST' });
    } catch {
      // ignore
    }
  }, []);

  const handleResumeProcessing = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/pages/process/resume', { method: 'POST' });
    } catch {
      // ignore
    }
  }, []);

  const handleResumeInterrupted = useCallback(async (): Promise<void> => {
    const pageIds = [...interruptedPages];
    setInterruptedPages([]);
    try {
      await fetch('/api/pages/process/interrupted', { method: 'POST' });
      setPages((prev) => prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'pending' } : p)));
      // Start processing
      setProcessingPageIds(new Set(pageIds));
      setProcessingStep('Spouštím zpracování…');
      setProcessingProgress(0);
      setError(null);
      setPages((prev) =>
        prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'processing' } : p)),
      );
      const response = await fetch('/api/pages/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, language: 'cs', mode: processingMode }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      await consumeProcessingStream(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setProcessingPageIds(new Set());
      setBatchInfo(null);
      batchInfoRef.current = null;
      setIsPaused(false);
      setTimeout(() => {
        setProcessingStep(undefined);
        setProcessingProgress(undefined);
      }, 2000);
    }
  }, [interruptedPages, processingMode, consumeProcessingStream, setPages]);

  const handleResetInterrupted = useCallback(async (): Promise<void> => {
    const pageIds = [...interruptedPages];
    setInterruptedPages([]);
    try {
      await fetch('/api/pages/process/interrupted', { method: 'POST' });
      setPages((prev) => prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'pending' } : p)));
    } catch {
      // ignore
    }
  }, [interruptedPages, setPages]);

  const isProcessing = processingPageIds.size > 0;

  return {
    processingPageIds,
    processingStep,
    processingProgress,
    isPaused,
    interruptedPages,
    isProcessing,
    handleProcessSelected,
    handleCancelProcessing,
    handlePauseProcessing,
    handleResumeProcessing,
    handleResumeInterrupted,
    handleResetInterrupted,
    setError,
    error,
  };
}
