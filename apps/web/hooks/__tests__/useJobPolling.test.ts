import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hook bez Reactu: useRef/useCallback/useEffect jako prosté funkce – testuje se
// jen logika pollu (kdy se volá onErrorCode a jak se Promise vyřeší).
vi.mock('react', () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(fn: T) => fn,
  useEffect: () => undefined,
}));

const mockApiFetch = vi.fn();
vi.mock('@/lib/infrastructure/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Alias bez prefixu „use“ – volá se mimo komponentu (React je výše mockovaný)
import { useJobPolling as createJobPolling } from '../useJobPolling';

function statusResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockApiFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function poll(body: Record<string, unknown>): Promise<{
  outcome: string;
  codes: (string | null)[];
}> {
  mockApiFetch.mockResolvedValue(statusResponse(body));
  const { pollJob } = createJobPolling();
  const codes: (string | null)[] = [];
  const promise = pollJob('job-1', { onErrorCode: (code) => codes.push(code) });
  await vi.advanceTimersByTimeAsync(2000);
  return { outcome: await promise, codes };
}

describe('useJobPolling – kód chyby ukončeného jobu', () => {
  it('chyba jobu předá kód (credit_busy)', async () => {
    const result = await poll({ status: 'error', errorCode: 'credit_busy' });
    expect(result).toEqual({ outcome: 'error', codes: ['credit_busy'] });
  });

  it('doběhlý job, který část stránek přeskočil kvůli kreditu, předá kód také', async () => {
    const result = await poll({ status: 'completed', errorCode: 'insufficient_credit' });
    expect(result).toEqual({ outcome: 'completed', codes: ['insufficient_credit'] });
  });

  it('doběhlý job bez kódu předá null, zrušený job kód nepředá', async () => {
    expect(await poll({ status: 'completed', errorCode: null })).toEqual({
      outcome: 'completed',
      codes: [null],
    });
    expect(await poll({ status: 'cancelled' })).toEqual({ outcome: 'cancelled', codes: [] });
  });
});
