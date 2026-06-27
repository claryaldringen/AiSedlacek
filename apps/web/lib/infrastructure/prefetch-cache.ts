import crypto from 'crypto';
import { safeFetch, readBodyWithLimit } from './safe-fetch';

/**
 * In-memory prefetch cache for URL imports.
 * Stores downloaded image buffers keyed by URL hash.
 * Entries expire after 10 minutes.
 */

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  contentDisposition: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<CacheEntry | null>>();

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRY_BYTES = 25 * 1024 * 1024; // 25 MB per entry
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // cap whole cache to bound memory

function totalBytes(): number {
  let sum = 0;
  for (const entry of cache.values()) sum += entry.buffer.length;
  return sum;
}

/** Evict oldest entries (insertion order) until under the global byte cap. */
function enforceCapacity(): void {
  while (totalBytes() > MAX_TOTAL_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function urlKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > TTL_MS) cache.delete(key);
  }
}

export function getCached(url: string): CacheEntry | null {
  evictExpired();
  return cache.get(urlKey(url)) ?? null;
}

/**
 * Prefetch a URL in the background. If already cached or in-flight, skips.
 */
export function prefetch(url: string): void {
  evictExpired();
  const key = urlKey(url);
  if (cache.has(key) || pending.has(key)) return;

  const promise = (async (): Promise<CacheEntry | null> => {
    try {
      // safeFetch validates the URL (and every redirect) against SSRF ranges.
      const response = await safeFetch(url, {
        headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!contentType.startsWith('image/')) return null;

      // Enforce the per-entry size cap while streaming (don't buffer the whole body first).
      let buffer: Buffer;
      try {
        buffer = await readBodyWithLimit(response, MAX_ENTRY_BYTES);
      } catch {
        return null;
      }

      const entry: CacheEntry = {
        buffer,
        contentType,
        contentDisposition: response.headers.get('content-disposition') ?? '',
        timestamp: Date.now(),
      };
      cache.set(key, entry);
      enforceCapacity();
      return entry;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, promise);
}

/**
 * Get cached entry, or wait for in-flight prefetch to complete.
 */
export async function getOrWait(url: string): Promise<CacheEntry | null> {
  evictExpired();
  const key = urlKey(url);
  const cached = cache.get(key);
  if (cached) return cached;

  const inflight = pending.get(key);
  if (inflight) return inflight;

  return null;
}
