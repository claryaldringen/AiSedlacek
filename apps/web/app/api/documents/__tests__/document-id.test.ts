import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    translation: { upsert: (...args: unknown[]) => mockUpsert(...args) },
  },
}));

const mockCreateVersion = vi.fn();
vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
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

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1', {
    method: 'GET',
  });
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request('http://localhost/api/documents/doc-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1', {
    method: 'DELETE',
  });
}

const FAKE_DOC = {
  id: 'doc-1',
  transcription: 'Starý text',
  context: 'Kontext dokumentu',
  translations: [{ language: 'cs', text: 'Český překlad' }],
  glossary: [{ term: 'slovo', definition: 'význam' }],
  page: { userId: 'test-user-id' },
};

// ── Import route handlers (after mocks) ──────────────────

import { GET, PATCH, DELETE } from '@/app/api/documents/[id]/route';

// ── GET Tests ────────────────────────────────────────────

describe('GET /api/documents/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns document with translations and glossary', async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await GET(makeGetRequest(), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('doc-1');
    expect(json.transcription).toBe('Starý text');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      include: { translations: true, glossary: true, page: { select: { userId: true } } },
    });
  });

  it('returns 404 when document not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Dokument nenalezen');
  });
});

// ── PATCH Tests ──────────────────────────────────────────

describe('PATCH /api/documents/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateVersion.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    mockUpsert.mockResolvedValue({});
  });

  it('updates transcription and calls createVersion with old value before updating', async () => {
    // First findUnique: fetch current state for versioning and ownership check
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);
    // Second findUnique: fetch updated document to return
    const updatedDoc = { ...FAKE_DOC, transcription: 'Nový text' };
    mockFindUnique.mockResolvedValueOnce(updatedDoc);

    const res = await PATCH(makePatchRequest({ transcription: 'Nový text' }), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transcription).toBe('Nový text');

    // createVersion should be called with old transcription
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'transcription',
      'Starý text',
      'manual_edit',
    );

    // createVersion must be called before document.update
    const versionCallOrder = mockCreateVersion.mock.invocationCallOrder[0]!;
    const updateCallOrder = mockUpdate.mock.invocationCallOrder[0]!;
    expect(versionCallOrder).toBeLessThan(updateCallOrder);
  });

  it('returns 404 when document not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await PATCH(makePatchRequest({ transcription: 'Nový text' }), routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Dokument nenalezen');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/documents/doc-1', {
        method: 'PATCH',
        body: 'not json{{{',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });

  it('does not call createVersion or update when transcription is unchanged', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);

    const res = await PATCH(makePatchRequest({ transcription: 'Starý text' }), routeContext);

    expect(res.status).toBe(200);
    expect(mockCreateVersion).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('upserts translation when translation and translationLanguage are provided', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);

    const res = await PATCH(
      makePatchRequest({ translation: 'Nový překlad', translationLanguage: 'cs' }),
      routeContext,
    );

    expect(res.status).toBe(200);

    // Should version the old translation first
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'translation:cs',
      'Český překlad',
      'manual_edit',
    );

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { documentId_language: { documentId: 'doc-1', language: 'cs' } },
      update: { text: 'Nový překlad' },
      create: { documentId: 'doc-1', language: 'cs', text: 'Nový překlad' },
    });
  });

  it('versions context field when context changes', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC);
    mockFindUnique.mockResolvedValueOnce({ ...FAKE_DOC, context: 'Nový kontext' });

    const res = await PATCH(makePatchRequest({ context: 'Nový kontext' }), routeContext);

    expect(res.status).toBe(200);

    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'context',
      'Kontext dokumentu',
      'manual_edit',
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { context: 'Nový kontext' },
    });
  });
});

// ── DELETE Tests ──────────────────────────────────────────

describe('DELETE /api/documents/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: document found and owned by test user
    mockFindUnique.mockResolvedValue(FAKE_DOC);
  });

  it('deletes document successfully', async () => {
    mockDelete.mockResolvedValue({ id: 'doc-1' });

    const res = await DELETE(makeDeleteRequest(), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });

  it('returns 404 when document not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest(), routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Dokument nenalezen');
  });
});
