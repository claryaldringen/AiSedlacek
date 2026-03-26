'use client';

import { useCallback, useRef } from 'react';
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
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
      stopPolling();
      const ms = options?.intervalMs ?? 2000;

      return new Promise((resolve) => {
        intervalRef.current = setInterval(async () => {
          try {
            const res = await apiFetch(`/api/pages/process/status?jobId=${jobId}`);
            if (!res.ok) {
              stopPolling();
              resolve('error');
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
              stopPolling();
              resolve(data.status as 'completed' | 'error' | 'cancelled');
            }
          } catch {
            stopPolling();
            resolve('error');
          }
        }, ms);
      });
    },
    [stopPolling],
  );

  return { pollJob, stopPolling };
}
