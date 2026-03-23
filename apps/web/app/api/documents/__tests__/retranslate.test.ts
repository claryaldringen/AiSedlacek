import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockDocFindUnique = vi.fn();
const mockJobCreate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: { findUnique: (...args: unknown[]) => mockDocFindUnique(...args) },
    processingJob: { create: (...args: unknown[]) => mockJobCreate(...args) },
  },
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: vi.fn().mockResolvedValue({ balance: 1_000_000, sufficient: true }),
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));

vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request('http://localhost/api/documents/doc-1/retranslate', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

const FAKE_DOC = {
  id: 'doc-1',
  transcription: 'Starý text z roku 1420',
  translations: [],
  page: { userId: 'test-user-id' },
};

// ── Import route handler (after mocks) ──────────────────

import { POST } from '@/app/api/documents/[id]/retranslate/route';

// ── Tests ────────────────────────────────────────────────

describe('POST /api/documents/[id]/retranslate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobCreate.mockResolvedValue({ id: 'job-123' });
  });

  it('returns 404 when document not found', async () => {
    mockDocFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ language: 'cs' }), routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Dokument nenalezen');
  });

  it('enqueues a retranslate job and returns jobId', async () => {
    mockDocFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await POST(makeRequest({ language: 'cs' }), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe('job-123');

    // Verify job was created with correct data
    expect(mockJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'test-user-id',
        status: 'queued',
        type: 'retranslate',
        totalPages: 1,
      }),
    });

    // Verify jobData contains documentId and language
    const callArg = mockJobCreate.mock.calls[0]![0] as { data: { jobData: string } };
    const jobData = JSON.parse(callArg.data.jobData) as Record<string, unknown>;
    expect(jobData.documentId).toBe('doc-1');
    expect(jobData.language).toBe('cs');
  });

  it("defaults to 'cs' language when not provided", async () => {
    mockDocFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await POST(makeRequest({}), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobId).toBe('job-123');

    // Verify jobData has language 'cs'
    const callArg = mockJobCreate.mock.calls[0]![0] as { data: { jobData: string } };
    const jobData = JSON.parse(callArg.data.jobData) as Record<string, unknown>;
    expect(jobData.language).toBe('cs');
  });

  it('includes previousTranslation in jobData when provided', async () => {
    mockDocFindUnique.mockResolvedValue(FAKE_DOC);

    const req = makeRequest({
      language: 'cs',
      previousTranslation: 'Starý překlad',
    });
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);

    const callArg = mockJobCreate.mock.calls[0]![0] as { data: { jobData: string } };
    const jobData = JSON.parse(callArg.data.jobData) as Record<string, unknown>;
    expect(jobData.previousTranslation).toBe('Starý překlad');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/documents/doc-1/retranslate', {
        method: 'POST',
        body: 'not json{{{',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });
});
