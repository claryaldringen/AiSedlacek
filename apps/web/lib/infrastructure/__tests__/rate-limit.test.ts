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

  it('releaseRateLimit does not give back an attempt into a newer window', () => {
    vi.useFakeTimers();
    try {
      const { rateLimit, releaseRateLimit } = mod;
      const key = 'release-window';
      const first = rateLimit(key, 2, 1_000); // okno 1
      vi.advanceTimersByTime(1_001);
      rateLimit(key, 2, 1_000); // okno 2: 1 pokus jiného requestu
      rateLimit(key, 2, 1_000); // okno 2: 2 pokusy – plno
      releaseRateLimit(key, first.windowId); // pokus z okna 1 se do okna 2 nevrací
      expect(rateLimit(key, 2, 1_000).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releaseRateLimit gives back one counted attempt, never below zero', () => {
    const { rateLimit, releaseRateLimit } = mod;
    const key = 'release:key';
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);

    releaseRateLimit(key);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true); // uvolněné místo
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);

    for (let i = 0; i < 5; i++) releaseRateLimit(key);
    // Ne pod nulu: po dvou pokusech je limit zase plný.
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);
  });

  it('releaseRateLimit ignores unknown and expired keys', () => {
    vi.useFakeTimers();
    try {
      const { rateLimit, releaseRateLimit, bucketCount } = mod;
      releaseRateLimit('unknown');
      expect(bucketCount()).toBe(0); // nezakládá bucket

      rateLimit('expiring', 1, 1_000);
      vi.advanceTimersByTime(1_001);
      releaseRateLimit('expiring');
      expect(rateLimit('expiring', 1, 1_000).ok).toBe(true);
      expect(rateLimit('expiring', 1, 1_000).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetRateLimit clears the counter of a key', () => {
    const { rateLimit, resetRateLimit } = mod;
    rateLimit('reset:key', 1, 60_000);
    expect(rateLimit('reset:key', 1, 60_000).ok).toBe(false);

    resetRateLimit('reset:key');

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
