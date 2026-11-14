import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Duplicitní textový job (review 3. kolo): stejná akce nad svazkem, která už čeká
// nebo běží, se znovu nezaloží – route vrátí 409 s jobId běžícího jobu ještě před
// kontrolou kreditu (rezervace běžícího jobu by jinak vyvolala credit_busy).

const mockCollectionFindUnique = vi.fn();
const mockJobFindFirst = vi.fn();
const mockJobCreate = vi.fn();
const mockCheckBalance = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: { findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args) },
    processingJob: {
      findFirst: (...args: unknown[]) => mockJobFindFirst(...args),
      create: (...args: unknown[]) => mockJobCreate(...args),
    },
  },
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: (...args: unknown[]) => mockCheckBalance(...args),
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { POST as generateContext } from '@/app/api/collections/[id]/generate-context/route';
import { POST as translateContext } from '@/app/api/collections/[id]/translate-context/route';
import { POST as fixDocumentContexts } from '@/app/api/collections/[id]/fix-document-contexts/route';

function post(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/collections/col-1/${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
  });
}

const ctx = { params: Promise.resolve({ id: 'col-1' }) };

const ROUTES = [
  {
    type: 'generate-context',
    call: () => generateContext(post('generate-context', { pageIds: ['p1'] }), ctx),
    // jobData běžícího jobu se stejnými parametry (jak ho route zakládá)
    jobData: { collectionId: 'col-1', pageIds: ['p1'], userId: 'user-1' },
  },
  {
    type: 'translate-context',
    call: () => translateContext(post('translate-context', { targetLanguage: 'en' }), ctx),
    jobData: { collectionId: 'col-1', targetLanguage: 'en', userId: 'user-1' },
  },
  {
    type: 'fix-contexts',
    call: () => fixDocumentContexts(post('fix-document-contexts'), ctx),
    jobData: { collectionId: 'col-1', userId: 'user-1' },
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectionFindUnique.mockResolvedValue({
    id: 'col-1',
    userId: 'user-1',
    context: 'Kontext svazku',
    pages: [{ id: 'p1' }],
  });
  mockCheckBalance.mockResolvedValue({
    balance: 1_000_000,
    reserved: 0,
    available: 1_000_000,
    required: 1,
    sufficient: true,
  });
  mockJobFindFirst.mockResolvedValue(null);
  mockJobCreate.mockResolvedValue({ id: 'job-new' });
});

describe.each(ROUTES)('$type – duplicitní job', ({ type, call, jobData }) => {
  it('stejná akce nad svazkem už běží: 409 s jobId, bez kontroly kreditu a nového jobu', async () => {
    mockJobFindFirst.mockResolvedValue({ id: 'job-running', jobData: JSON.stringify(jobData) });

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Stejná akce už běží – počkejte na její dokončení.',
      code: 'job_running',
      jobId: 'job-running',
    });
    expect(mockJobFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type,
        status: { in: ['queued', 'running'] },
        collectionId: 'col-1',
      },
      select: { id: true, jobData: true },
    });
    expect(mockCheckBalance).not.toHaveBeenCalled();
    expect(mockJobCreate).not.toHaveBeenCalled();
  });

  it('žádný běžící job: založí nový', async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: 'job-new' });
    expect(mockJobCreate.mock.calls[0]![0].data.type).toBe(type);
  });
});

// Známé omezení PR #7: UI při 409 sledovalo běžící job, i když měl jiné stránky
// nebo cílový jazyk – výsledek pak neodpovídal tomu, co uživatel chtěl.
describe('kontext svazku – běžící job s jinými parametry', () => {
  const OTHER_PARAMS = {
    error:
      'Pro tento svazek už běží stejná akce s jinými parametry (jiné stránky nebo jazyk) – ' +
      'počkejte na její dokončení a pak ji spusťte znovu.',
    code: 'job_running_other',
  };

  function running(jobData: unknown): void {
    mockJobFindFirst.mockResolvedValue({
      id: 'job-running',
      jobData: typeof jobData === 'string' ? jobData : JSON.stringify(jobData),
    });
  }

  it('generování z jiných stránek: 409 bez jobId (UI cizí job nesleduje), nic nezaloží', async () => {
    running({ collectionId: 'col-1', pageIds: ['p1', 'p2'], userId: 'user-1' });

    const res = await generateContext(post('generate-context', { pageIds: ['p1'] }), ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(OTHER_PARAMS);
    expect(mockCheckBalance).not.toHaveBeenCalled();
    expect(mockJobCreate).not.toHaveBeenCalled();
  });

  it('generování ze stejných stránek v jiném pořadí: sleduje běžící job', async () => {
    running({ collectionId: 'col-1', pageIds: ['p2', 'p1'], userId: 'user-1' });

    const res = await generateContext(
      post('generate-context', { pageIds: ['p1', 'p2', 'p1'] }),
      ctx,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'job_running', jobId: 'job-running' });
  });

  it('překlad kontextu do jiného jazyka: 409 bez jobId', async () => {
    running({ collectionId: 'col-1', targetLanguage: 'de', userId: 'user-1' });

    const res = await translateContext(post('translate-context', { targetLanguage: 'en' }), ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(OTHER_PARAMS);
    expect(mockJobCreate).not.toHaveBeenCalled();
  });

  it.each([['není JSON'], [null], ['null']])(
    'nečitelný jobData (%s) se bere jako jiné parametry – nic se nesleduje',
    async (jobData) => {
      mockJobFindFirst.mockResolvedValue({ id: 'job-running', jobData });

      const res = await translateContext(post('translate-context', { targetLanguage: 'en' }), ctx);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(OTHER_PARAMS);
    },
  );
});
