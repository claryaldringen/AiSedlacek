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

// Oprava kontextů počítá přeskočené dokumenty z `errors` ukončeného jobu.
describe('useJobPolling – errors ukončeného jobu (onErrors)', () => {
  async function pollErrors(
    body: Record<string, unknown>,
  ): Promise<{ outcome: string; errors: string[][] }> {
    mockApiFetch.mockResolvedValue(statusResponse(body));
    const { pollJob } = createJobPolling();
    const errors: string[][] = [];
    const promise = pollJob('job-1', { onErrors: (e) => errors.push(e) });
    await vi.advanceTimersByTimeAsync(2000);
    return { outcome: await promise, errors };
  }

  it('předá errors u jobu ukončeného chybou i doběhlého jobu', async () => {
    const errors = ['Dokument doc-1: přeskočen …', 'Nedostatečný kredit …'];
    expect(await pollErrors({ status: 'error', errorCode: 'credit_busy', errors })).toEqual({
      outcome: 'error',
      errors: [errors],
    });
    expect(await pollErrors({ status: 'completed', errors: ['Stránka p1: …'] })).toEqual({
      outcome: 'completed',
      errors: [['Stránka p1: …']],
    });
  });

  it('chybějící nebo nečitelné errors → prázdné pole', async () => {
    for (const errors of [undefined, null, 'text', { 0: 'x' }]) {
      expect(await pollErrors({ status: 'error', errors })).toEqual({
        outcome: 'error',
        errors: [[]],
      });
    }
    expect(await pollErrors({ status: 'completed' })).toEqual({
      outcome: 'completed',
      errors: [[]],
    });
  });

  it('zrušený ani ještě běžící job errors nepředá', async () => {
    expect(await pollErrors({ status: 'cancelled', errors: ['x'] })).toEqual({
      outcome: 'cancelled',
      errors: [],
    });

    mockApiFetch.mockResolvedValue(statusResponse({ status: 'running', errors: ['x'] }));
    const { pollJob, stopPolling } = createJobPolling();
    const received: string[][] = [];
    void pollJob('job-1', { onErrors: (e) => received.push(e) });
    await vi.advanceTimersByTimeAsync(4000);
    stopPolling();
    expect(received).toEqual([]);
  });
});
