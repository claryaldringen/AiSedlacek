import { describe, it, expect } from 'vitest';
import { rateLimit, MAX_BUCKETS } from '../rate-limit';

describe('rateLimit', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('caps the number of buckets under a flood of distinct keys', () => {
    const victim = `victim:${Math.random()}`;
    rateLimit(victim, 1, 60_000);
    expect(rateLimit(victim, 1, 60_000).ok).toBe(false);

    for (let i = 0; i < MAX_BUCKETS + 10; i++) rateLimit(`flood:${i}`, 1, 60_000);

    // Nejstarší bucket byl vyhozen – mapa nepřekročila strop (a nepadla na paměť).
    expect(rateLimit(victim, 1, 60_000).ok).toBe(true);
  });
});
