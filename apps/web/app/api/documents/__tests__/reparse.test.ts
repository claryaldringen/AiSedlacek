import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockDocFindUnique = vi.fn();
const mockTranslationFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockPageUpdate = vi.fn();
const mockCreateVersion = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      findUnique: (...args: unknown[]) => mockDocFindUnique(...args),
      update: vi.fn((args: unknown) => ({ op: 'document.update', args })),
    },
    translation: {
      findUnique: (...args: unknown[]) => mockTranslationFindUnique(...args),
      upsert: vi.fn((args: unknown) => ({ op: 'translation.upsert', args })),
    },
    glossaryEntry: {
      deleteMany: vi.fn((args: unknown) => ({ op: 'glossary.deleteMany', args })),
      createMany: vi.fn((args: unknown) => ({ op: 'glossary.createMany', args })),
    },
    page: { update: (...args: unknown[]) => mockPageUpdate(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { POST } from '@/app/api/documents/[id]/reparse/route';

// ── Helpers ──────────────────────────────────────────────

const rawResponse = JSON.stringify({
  transcription: 'Nový přepis',
  detectedLanguage: 'cs-old',
  translation: 'Nový překlad',
  translationLanguage: 'cs',
  context: 'Nový kontext',
  glossary: [{ term: 'purkmistr', definition: 'starosta' }],
});

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1/reparse', {
    method: 'POST',
    headers: { 'x-locale': 'cs' },
  });
}

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

describe('POST /api/documents/[id]/reparse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'Starý přepis',
      context: 'Ručně upravený kontext',
      model: 'claude-opus-4-6',
      rawResponse,
      page: { id: 'page-1', userId: 'user-1' },
    });
    mockTranslationFindUnique.mockResolvedValue({ text: 'Starý překlad' });
    mockTransaction.mockResolvedValue([]);
    mockPageUpdate.mockResolvedValue({});
  });

  it('versions transcription, context and translation before overwriting', async () => {
    const res = await POST(makeRequest(), routeContext);

    expect(res.status).toBe(200);
    const fields = mockCreateVersion.mock.calls.map((c) => [c[1], c[2]]);
    expect(fields).toEqual([
      ['transcription', 'Starý přepis'],
      ['context', 'Ručně upravený kontext'],
      ['translation:cs', 'Starý překlad'],
    ]);
  });

  it('writes document, translation and glossary in a single transaction', async () => {
    await POST(makeRequest(), routeContext);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const ops = (mockTransaction.mock.calls[0]![0] as { op: string }[]).map((o) => o.op);
    expect(ops).toEqual([
      'document.update',
      'translation.upsert',
      'glossary.deleteMany',
      'glossary.createMany',
    ]);
  });

  it('returns 422 and writes nothing when rawResponse cannot be parsed', async () => {
    mockDocFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'Starý přepis',
      context: '',
      model: null,
      rawResponse: 'tohle není JSON',
      page: { id: 'page-1', userId: 'user-1' },
    });

    const res = await POST(makeRequest(), routeContext);

    expect(res.status).toBe(422);
    expect(mockCreateVersion).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 for a document of another user', async () => {
    mockDocFindUnique.mockResolvedValue({
      id: 'doc-1',
      rawResponse,
      page: { id: 'page-1', userId: 'someone-else' },
    });

    const res = await POST(makeRequest(), routeContext);

    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
