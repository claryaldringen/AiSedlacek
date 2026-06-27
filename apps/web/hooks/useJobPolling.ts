'use client';

import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/infrastructure/api-client';

interface JobStatus {
  status: string;
  currentStep?: string;
  completedPages?: number;
  totalPages?: number;
  progress?: number;
}

/**
 * Reusable hook for polling ProcessingJob status.
 * Returns a startPolling function that resolves when the job completes.
 */
export function useJobPolling() {
  // Všechny běžící intervaly. Každé volání pollJob má vlastní interval —
  // sdílený ref by způsobil, že spuštění druhého pollu zruší interval prvního
  // a jeho Promise by se nikdy neresolvnula (zaseknutý await).
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const stopPolling = useCallback(() => {
    for (const interval of intervalsRef.current) {
      clearInterval(interval);
    }
    intervalsRef.current.clear();
  }, []);

  // Úklid na unmount — zastav všechny rozběhnuté polly.
  useEffect(() => {
    return () => {
      for (const interval of intervalsRef.current) {
        clearInterval(interval);
      }
      intervalsRef.current.clear();
    };
  }, []);

  const pollJob = useCallback(
    (
      jobId: string,
      options?: {
        intervalMs?: number;
        onStep?: (step: string) => void;
        onProgress?: (completed: number, total: number) => void;
      },
    ): Promise<'completed' | 'error' | 'cancelled'> => {
      const ms = options?.intervalMs ?? 2000;

      return new Promise((resolve) => {
        let interval: ReturnType<typeof setInterval> | null = null;

        // Ukončí pouze tento poll (ne ostatní běžící) a vždy resolvne Promise,
        // aby na ni čekající await nikdy nevisel. Idempotentní díky null guardu.
        const settle = (status: 'completed' | 'error' | 'cancelled'): void => {
          if (interval !== null) {
            clearInterval(interval);
            intervalsRef.current.delete(interval);
            interval = null;
          }
          resolve(status);
        };

        interval = setInterval(async () => {
          try {
            const res = await apiFetch(`/api/pages/process/status?jobId=${jobId}`);
            if (!res.ok) {
              settle('error');
              return;
            }
            const data = (await res.json()) as JobStatus;

            if (data.currentStep) options?.onStep?.(data.currentStep);
            if (data.completedPages != null && data.totalPages != null) {
              options?.onProgress?.(data.completedPages, data.totalPages);
            }

            if (
              data.status === 'completed' ||
              data.status === 'error' ||
              data.status === 'cancelled'
            ) {
              settle(data.status as 'completed' | 'error' | 'cancelled');
            }
          } catch {
            settle('error');
          }
        }, ms);
        intervalsRef.current.add(interval);
      });
    },
    [],
  );

  return { pollJob, stopPolling };
}
