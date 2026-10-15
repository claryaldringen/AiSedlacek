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

// Pojistky proti růstu paměti při floodu (klíče mohou být řízené klientem):
// úklid expirovaných bucketů nejvýš jednou za minutu (dřív při každém insertu
// nad 10 000 bucketů – O(n) na request) a tvrdý strop s vyhazováním nejstarších.
const SWEEP_INTERVAL_MS = 60_000;
export const MAX_BUCKETS = 50_000;
let lastSweep = 0;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number; windowId: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    // delete + set: znovu založený bucket se přesune na konec pořadí vložení.
    buckets.delete(key);
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      for (const [k, b] of buckets) {
        if (now > b.resetAt) buckets.delete(k);
      }
    }
    // Map drží pořadí vložení – první klíč je nejstarší bucket.
    while (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    return { ok: true, retryAfterSeconds: 0, windowId: resetAt };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      windowId: bucket.resetAt,
    };
  }
  bucket.count++;
  return { ok: true, retryAfterSeconds: 0, windowId: bucket.resetAt };
}

/**
 * Vrátí jeden započtený pokus (count − 1, ne pod nulu) – pro pokusy započtené
 * dopředu, které se nakonec počítat nemají (úspěšné přihlášení). `windowId`
 * (z `rateLimit`) zajistí, že se pokus vrátí jen do okna, ve kterém byl
 * započten – po přelomu okna by jinak uvolnil místo cizímu requestu.
 */
export function releaseRateLimit(key: string, windowId?: number): void {
  const bucket = buckets.get(key);
  if (!bucket || Date.now() > bucket.resetAt) return;
  if (windowId !== undefined && bucket.resetAt !== windowId) return;
  bucket.count = Math.max(0, bucket.count - 1);
}

/** Vynuluje limit klíče (např. neúspěšné pokusy účtu po úspěšném přihlášení). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** @internal Jen pro testy – počet držených bucketů (ověření stropu MAX_BUCKETS). */
export function bucketCount(): number {
  return buckets.size;
}

/** Best-effort client IP from proxy headers (Caddy sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
