import { describe, it, expect, beforeEach, vi } from 'vitest';

const loadModule = () => import('../rate-limit');
let mod: Awaited<ReturnType<typeof loadModule>>;

beforeEach(async () => {
  // Čerstvá instance modulu = prázdná mapa bucketů; testy nesdílí stav.
  vi.resetModules();
  mod = await loadModule();
});

describe('rateLimit', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const { rateLimit, bucketCount } = mod;
    const key = 'test:key';
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(bucketCount()).toBe(1);
  });

  it('peekRateLimit reads the state without counting an attempt', () => {
    const { rateLimit, peekRateLimit, bucketCount } = mod;
    const key = 'peek:key';

    for (let i = 0; i < 5; i++) expect(peekRateLimit(key, 2).ok).toBe(true);
    expect(bucketCount()).toBe(0); // čtení nezakládá bucket

    rateLimit(key, 2, 60_000);
    expect(peekRateLimit(key, 2).ok).toBe(true);
    rateLimit(key, 2, 60_000);
    const blocked = peekRateLimit(key, 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('peekRateLimit ignores an expired window', () => {
    vi.useFakeTimers();
    try {
      const { rateLimit, peekRateLimit } = mod;
      rateLimit('expiring', 1, 1_000);
      expect(peekRateLimit('expiring', 1).ok).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(peekRateLimit('expiring', 1).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetRateLimit clears the counter of a key', () => {
    const { rateLimit, peekRateLimit, resetRateLimit } = mod;
    rateLimit('reset:key', 1, 60_000);
    expect(peekRateLimit('reset:key', 1).ok).toBe(false);

    resetRateLimit('reset:key');

    expect(peekRateLimit('reset:key', 1).ok).toBe(true);
    expect(rateLimit('reset:key', 1, 60_000).ok).toBe(true);
  });

  it('caps the number of buckets under a flood of distinct keys', () => {
    const { rateLimit, bucketCount, MAX_BUCKETS } = mod;

    for (let i = 0; i < MAX_BUCKETS + 10; i++) rateLimit(`flood:${i}`, 1, 60_000);

    // Mapa nepřekročila strop (a nepadla na paměť).
    expect(bucketCount()).toBe(MAX_BUCKETS);
  });

  it('evicts the oldest bucket when the cap is hit – a deliberate trade-off (S2-21)', () => {
    // Cena stropu: flood distinct klíčů vyhodí i živý lockout. Test dokumentuje
    // současné chování; pokud se strop změní (S2-21), tahle aserce se obrátí.
    const { rateLimit, MAX_BUCKETS } = mod;
    const victim = 'victim:key';
    rateLimit(victim, 1, 60_000);
    expect(rateLimit(victim, 1, 60_000).ok).toBe(false);

    for (let i = 0; i < MAX_BUCKETS; i++) rateLimit(`flood:${i}`, 1, 60_000);

    expect(rateLimit(victim, 1, 60_000).ok).toBe(true);
  });
});
