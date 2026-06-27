/**
 * Minimal in-memory fixed-window rate limiter for sensitive unauthenticated
 * endpoints (registration, password reset, verification email). Guards against
 * mail-bombing, account enumeration and online password brute-force / bcrypt DoS.
 *
 * Note: state is per-process. With a single web instance (current deploy) this is
 * effective; a multi-instance deployment should move this to Redis/DB.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now > b.resetAt) buckets.delete(k);
      }
    }
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count++;
  return { ok: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP from proxy headers (Caddy sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
