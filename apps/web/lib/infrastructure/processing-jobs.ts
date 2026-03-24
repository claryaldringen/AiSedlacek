/** Legacy no-op stub — cancel endpoint uses DB-based cancellation now. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function cancelJob(_userId: string): boolean {
  return false;
}
