/**
 * Legacy stub — kept only because apps/web/app/api/pages/process/cancel/route.ts
 * (owned by another user and not writable) still imports cancelJob from here.
 *
 * Cancellation now happens via the /api/pages/process/status POST endpoint
 * which sets the ProcessingJob DB record to 'cancelled'. The BullMQ worker
 * checks this flag between batches.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function cancelJob(_userId: string): boolean {
  // No-op: in-memory job tracking has been removed.
  // Cancellation is now DB-based (ProcessingJob.status = 'cancelled').
  return false;
}
