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
  },
  {
    type: 'translate-context',
    call: () => translateContext(post('translate-context', { targetLanguage: 'en' }), ctx),
  },
  {
    type: 'fix-contexts',
    call: () => fixDocumentContexts(post('fix-document-contexts'), ctx),
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

describe.each(ROUTES)('$type – duplicitní job', ({ type, call }) => {
  it('stejná akce nad svazkem už běží: 409 s jobId, bez kontroly kreditu a nového jobu', async () => {
    mockJobFindFirst.mockResolvedValue({ id: 'job-running' });

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
      select: { id: true },
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
