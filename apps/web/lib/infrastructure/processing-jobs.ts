/**
 * In-memory processing job state.
 * Jobs run as detached Promises — they continue even if the SSE client disconnects.
 * Clients can reconnect and replay all buffered events.
 */

export interface ProcessingEvent {
  event: string;
  data: unknown;
}

export interface ProcessingJob {
  userId: string;
  pageIds: string[];
  events: ProcessingEvent[];
  completed: boolean;
  abortController: AbortController;
  listeners: Set<(evt: ProcessingEvent) => void>;
  paused: boolean;
  pausePromise: Promise<void> | null;
  pauseResolve: (() => void) | null;
}

const activeJobs = new Map<string, ProcessingJob>();

export function getActiveJob(userId: string): ProcessingJob | undefined {
  const job = activeJobs.get(userId);
  return job;
}

export function createJob(userId: string, pageIds: string[]): ProcessingJob {
  const existing = activeJobs.get(userId);
  if (existing && !existing.completed) {
    throw new Error('Již probíhá zpracování');
  }

  const job: ProcessingJob = {
    userId,
    pageIds,
    events: [],
    completed: false,
    abortController: new AbortController(),
    listeners: new Set(),
    paused: false,
    pausePromise: null,
    pauseResolve: null,
  };
  activeJobs.set(userId, job);
  return job;
}

export function emitEvent(userId: string, event: string, data: unknown): void {
  const job = activeJobs.get(userId);
  if (!job) return;
  const evt: ProcessingEvent = { event, data };
  job.events.push(evt);
  for (const listener of job.listeners) {
    try {
      listener(evt);
    } catch {
      job.listeners.delete(listener);
    }
  }
}

export function completeJob(userId: string): void {
  const job = activeJobs.get(userId);
  if (!job) return;
  job.completed = true;
  // Keep job in memory for 5 minutes so clients can reconnect and see final state
  setTimeout(
    () => {
      const current = activeJobs.get(userId);
      if (current === job) activeJobs.delete(userId);
    },
    5 * 60 * 1000,
  );
}

export function cancelJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || job.completed) return false;
  job.pauseResolve?.();
  job.pausePromise = null;
  job.pauseResolve = null;
  job.paused = false;
  job.abortController.abort();
  return true;
}

export function pauseJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || job.completed || job.paused) return false;
  job.paused = true;
  job.pausePromise = new Promise<void>((resolve) => {
    job.pauseResolve = resolve;
  });
  return true;
}

export function resumeJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || !job.paused) return false;
  job.paused = false;
  job.pauseResolve?.();
  job.pausePromise = null;
  job.pauseResolve = null;
  return true;
}

export function isJobPaused(userId: string): boolean {
  const job = activeJobs.get(userId);
  return job?.paused ?? false;
}
