import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockPageFindMany = vi.fn();
const mockPageUpdateMany = vi.fn();
const mockProcessingJobFindFirst = vi.fn();
const mockProcessingJobCreate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findMany: (...args: unknown[]) => mockPageFindMany(...args),
      updateMany: (...args: unknown[]) => mockPageUpdateMany(...args),
    },
    processingJob: {
      findFirst: (...args: unknown[]) => mockProcessingJobFindFirst(...args),
      create: (...args: unknown[]) => mockProcessingJobCreate(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: vi.fn().mockResolvedValue({ balance: 1_000_000, sufficient: true }),
  deductTokensIfSufficient: vi.fn().mockResolvedValue({ success: true, balance: 999_000 }),
}));


// ── Helpers ──────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pages/process', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Import route handler (after mocks) ──────────────────

import { POST } from '@/app/api/pages/process/route';

// ── Tests ────────────────────────────────────────────────

describe('POST /api/pages/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPageUpdateMany.mockResolvedValue({ count: 0 });
    mockProcessingJobFindFirst.mockResolvedValue(null); // No running job
    mockProcessingJobCreate.mockResolvedValue({ id: 'job-123', status: 'queued' });
    // Default: ownership check returns matching pages
    mockPageFindMany.mockImplementation((args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      if (where?.userId && where?.id) {
        const idFilter = where.id as { in?: string[] };
        if (idFilter.in) {
          return Promise.resolve(idFilter.in.map((id: string) => ({ id, collectionId: null })));
        }
      }
      return Promise.resolve([]);
    });
  });

  it('returns 400 when pageIds is missing', async () => {
    const res = await POST(makeRequest({ language: 'cs' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Chybí pageIds');
  });

  it('returns 400 when pageIds is empty array', async () => {
    const res = await POST(makeRequest({ pageIds: [] }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('pageIds musí být neprázdné pole');
  });

  it('returns 409 when a job is already running', async () => {
    mockProcessingJobFindFirst.mockResolvedValue({ id: 'existing-job' });

    const res = await POST(makeRequest({ pageIds: ['page-1'] }));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Již probíhá zpracování');
    expect(json.jobId).toBe('existing-job');
  });

  it('creates a queued ProcessingJob in DB', async () => {
    const res = await POST(makeRequest({ pageIds: ['page-1', 'page-2'] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe('job-123');

    // Verify ProcessingJob was created with status 'queued'
    expect(mockProcessingJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'test-user-id',
          status: 'queued',
          totalPages: 2,
          pageIds: ['page-1', 'page-2'],
          language: 'cs',
          mode: 'transcribe+translate',
        }),
      }),
    );

    // Verify pages were set to processing
    expect(mockPageUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['page-1', 'page-2'] } },
      data: { status: 'processing', errorMessage: null },
    });
  });

  it('defaults target language to cs when not provided', async () => {
    await POST(makeRequest({ pageIds: ['page-1'] }));

    expect(mockProcessingJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          language: 'cs',
        }),
      }),
    );
  });

  it('uses provided language', async () => {
    await POST(makeRequest({ pageIds: ['page-1'], language: 'en' }));

    expect(mockProcessingJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          language: 'en',
        }),
      }),
    );
  });

  it('handles translate-only mode', async () => {
    await POST(makeRequest({ pageIds: ['page-1'], mode: 'translate' }));

    expect(mockProcessingJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'translate',
        }),
      }),
    );
  });

  it('returns 403 when pages do not belong to user', async () => {
    mockPageFindMany.mockResolvedValue([{ id: 'page-1' }]); // Only page-1 owned

    const res = await POST(makeRequest({ pageIds: ['page-1', 'page-999'] }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Některé stránky nepatří přihlášenému uživateli');
  });

  it('returns 402 when balance is insufficient', async () => {
    const { checkBalance } = await import('@/lib/infrastructure/billing');
    vi.mocked(checkBalance).mockResolvedValueOnce({ balance: 0, sufficient: false });

    const res = await POST(makeRequest({ pageIds: ['page-1'] }));

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe('Nedostatečný kredit');
  });
});
