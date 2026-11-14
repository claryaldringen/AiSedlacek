import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  followableJobId,
  jobToFollow,
  runRetranslation,
  waitForJobEnd,
  type JobEnd,
  type StartResponse,
} from '../job-follow';

const RUNNING = (jobId: string): StartResponse => ({
  status: 409,
  body: { code: 'job_running', jobId, error: 'Stejná akce už běží' },
});
const STARTED = (jobId: string): StartResponse => ({ status: 200, body: { jobId } });
const COMPLETED: JobEnd = { status: 'completed', errorCode: null };

describe('followableJobId / jobToFollow', () => {
  it('409 job_running s jobId → sledovat běžící job', () => {
    expect(followableJobId(409, { code: 'job_running', jobId: 'job-1' })).toBe('job-1');
    expect(jobToFollow(RUNNING('job-1'))).toBe('job-1');
  });

  it('nově založený job (200) → jeho jobId', () => {
    expect(jobToFollow(STARTED('job-2'))).toBe('job-2');
  });

  it('jiné odmítnutí (credit_busy 409, 402, bez jobId) se nesleduje', () => {
    expect(followableJobId(409, { code: 'credit_busy' })).toBeNull();
    expect(followableJobId(409, { code: 'job_running' })).toBeNull();
    expect(jobToFollow({ status: 402, body: { code: 'insufficient_credit' } })).toBeNull();
    expect(jobToFollow({ status: 200, body: {} })).toBeNull();
    expect(followableJobId(409, null)).toBeNull();
  });
});

describe('runRetranslation – úprava transkripce, když už retranslace běží', () => {
  function deps(responses: StartResponse[], ends: Record<string, JobEnd> = {}) {
    // Parametry (attempt, own) testy čtou z mock.calls
    const start = vi.fn<(attempt: number) => Promise<StartResponse>>(
      async () => responses.shift()!,
    );
    const waitForJob = vi.fn<(jobId: string, own: boolean) => Promise<JobEnd>>(
      async (jobId) => ends[jobId] ?? COMPLETED,
    );
    return { start, waitForJob, isStale: () => false };
  }

  it('bez souběhu: spustí retranslaci a počká na ni', async () => {
    const d = deps([STARTED('own')]);
    expect(await runRetranslation(d)).toEqual({ kind: 'done', end: COMPLETED });
    expect(d.waitForJob).toHaveBeenCalledWith('own', true);
  });

  it('409 job_running: počká na běžící retranslaci a pak spustí novou s aktuální transkripcí', async () => {
    const d = deps([RUNNING('other'), STARTED('own')], {
      own: { status: 'error', errorCode: 'output_truncated' },
    });

    const outcome = await runRetranslation(d);

    expect(d.waitForJob.mock.calls).toEqual([
      ['other', false],
      ['own', true],
    ]);
    // Druhé spuštění je opakování (attempt 1 – bez zastaralého previousTranslation)
    expect(d.start.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(outcome).toEqual({
      kind: 'done',
      end: { status: 'error', errorCode: 'output_truncated' },
    });
  });

  it('pořád znovu 409: po nejvýš maxFollow čekáních to vzdá', async () => {
    const d = deps([RUNNING('a'), RUNNING('b'), RUNNING('c'), RUNNING('d')]);

    expect(await runRetranslation({ ...d, maxFollow: 3 })).toEqual({ kind: 'still_running' });
    expect(d.waitForJob).toHaveBeenCalledTimes(3);
    expect(d.start).toHaveBeenCalledTimes(4);
  });

  it('jiné odmítnutí (kredit) vrátí odpověď s hláškou, nic nesleduje', async () => {
    const refused: StartResponse = { status: 409, body: { code: 'credit_busy', error: 'x' } };
    const d = deps([refused]);
    expect(await runRetranslation(d)).toEqual({ kind: 'not_started', response: refused });
    expect(d.waitForJob).not.toHaveBeenCalled();
  });

  it('přepnutý dokument během čekání: nic dalšího nespustí', async () => {
    let stale = false;
    const d = deps([RUNNING('other'), STARTED('own')]);
    d.waitForJob.mockImplementation(async () => {
      stale = true;
      return { status: 'cancelled', errorCode: null };
    });

    expect(await runRetranslation({ ...d, isStale: () => stale })).toEqual({ kind: 'stale' });
    expect(d.start).toHaveBeenCalledTimes(1);
  });
});

describe('waitForJobEnd – pollování stavu jobu', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });

  it('polluje do konce jobu, výpadek sítě pollování nepřeruší', async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 'running', currentStep: 'Volám model' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ status: 'error', errorCode: 'api_error' }));
    const onStep = vi.fn();

    const promise = waitForJobEnd('job-1', { fetchStatus, onStep, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);

    expect(await promise).toEqual({ status: 'error', errorCode: 'api_error' });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(onStep).toHaveBeenCalledWith('Volám model');
  });

  it('přechodná chyba serveru (502/503 při deployi, 429) pollování nepřeruší', async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'Bad Gateway' }, 502))
      .mockResolvedValueOnce(json({ error: 'Too Many Requests' }, 429))
      .mockResolvedValueOnce(json({ status: 'completed' }));

    const promise = waitForJobEnd('job-1', { fetchStatus, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);

    expect(await promise).toEqual({ status: 'completed', errorCode: null });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('nečitelný job (404) skončí chybou bez kódu', async () => {
    const promise = waitForJobEnd('job-1', {
      fetchStatus: async () => json({ error: 'x' }, 404),
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toEqual({ status: 'error', errorCode: null });
  });

  it('abort (přepnutí dokumentu) vrátí cancelled a další dotazy neposílá', async () => {
    const fetchStatus = vi.fn(async () => json({ status: 'running' }));
    const controller = new AbortController();

    const promise = waitForJobEnd('job-1', {
      fetchStatus,
      signal: controller.signal,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await promise).toEqual({ status: 'cancelled', errorCode: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
