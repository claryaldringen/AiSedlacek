import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Zrušení jobu (POST /api/pages/process/status) a ruční reset přerušených stránek
// (POST /api/pages/process/interrupted) vracejí nedokončené stránky stejně jako
// worker (resetUnfinishedPages): s dokumentem do `done`, bez dokumentu do `pending`.
// Archivované stránky se nepřepisují – reset se týká jen stavu `processing`.

// ── Mocks ────────────────────────────────────────────────

const mockJobFindUnique = vi.fn();
const mockJobFindFirst = vi.fn();
const mockJobUpdate = vi.fn();
const mockPageUpdateMany = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    processingJob: {
      findUnique: (...args: unknown[]) => mockJobFindUnique(...args),
      findFirst: (...args: unknown[]) => mockJobFindFirst(...args),
      update: (...args: unknown[]) => mockJobUpdate(...args),
    },
    page: { updateMany: (...args: unknown[]) => mockPageUpdateMany(...args) },
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { POST as cancelJob } from '@/app/api/pages/process/status/route';
import { POST as resetInterrupted } from '@/app/api/pages/process/interrupted/route';

// ── Helpers ──────────────────────────────────────────────

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pages/process/status', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
  });
}

const JOB = {
  id: 'job-1',
  userId: 'user-1',
  status: 'running',
  pageIds: ['page-1', 'page-2'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockJobFindUnique.mockResolvedValue(JOB);
  mockJobFindFirst.mockResolvedValue(JOB);
  mockJobUpdate.mockResolvedValue({ ...JOB, status: 'cancelled' });
  mockPageUpdateMany.mockResolvedValue({ count: 1 });
});

// ── Tests ────────────────────────────────────────────────

describe('POST /api/pages/process/status – cancel', () => {
  it('returns pages with a document to done and the rest to pending', async () => {
    const res = await cancelJob(post({ jobId: 'job-1', action: 'cancel' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled', jobId: 'job-1' });
    expect(mockJobUpdate).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'cancelled', currentStep: 'Zrušeno uživatelem' },
    });

    // Pořadí je podstatné – nejdřív stránky s dokumentem, pak zbytek.
    expect(mockPageUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { in: ['page-1', 'page-2'] },
        status: 'processing',
        document: { isNot: null },
      },
      data: { status: 'done', errorMessage: null },
    });
    expect(mockPageUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['page-1', 'page-2'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });

  it('never touches pages outside the processing state (e.g. archived)', async () => {
    await cancelJob(post({ jobId: 'job-1', action: 'cancel' }));

    for (const [args] of mockPageUpdateMany.mock.calls) {
      expect((args as { where: { status: string } }).where.status).toBe('processing');
    }
  });

  it('returns 404 for a job of another user and resets nothing', async () => {
    mockJobFindUnique.mockResolvedValue({ ...JOB, userId: 'user-2' });

    const res = await cancelJob(post({ jobId: 'job-1', action: 'cancel' }));

    expect(res.status).toBe(404);
    expect(mockJobUpdate).not.toHaveBeenCalled();
    expect(mockPageUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the job is already finished', async () => {
    mockJobFindUnique.mockResolvedValue({ ...JOB, status: 'completed' });

    const res = await cancelJob(post({ jobId: 'job-1', action: 'cancel' }));

    expect(res.status).toBe(404);
    expect(mockPageUpdateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/pages/process/interrupted', () => {
  it('resets processing pages of the user like the worker does', async () => {
    mockPageUpdateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 3 });

    const res = await resetInterrupted();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: 5 });
    expect(mockPageUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1', status: 'processing', document: { isNot: null } },
      data: { status: 'done', errorMessage: null },
    });
    expect(mockPageUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });
});
