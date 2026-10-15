import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// PATCH /api/documents/[id]: překlad bez translationLanguage musí skončit 400
// a nic se nesmí uložit (DAT-3 – dříve se překlad tiše ignoroval a vrátilo se 200,
// takže `ais push` změnu označil za odeslanou).

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    translation: { upsert: (...args: unknown[]) => mockUpsert(...args) },
  },
}));

const mockCreateVersion = vi.fn();
vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  resolveUserId: vi.fn().mockResolvedValue({ userId: 'test-user-id' }),
}));

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request('http://localhost/api/documents/doc-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const FAKE_DOC = {
  id: 'doc-1',
  transcription: 'Starý text',
  context: 'Kontext dokumentu',
  translations: [{ language: 'cs', text: 'Český překlad' }],
  glossary: [],
  page: { userId: 'test-user-id' },
};

const { PATCH } = await import('@/app/api/documents/[id]/route');

describe('PATCH /api/documents/[id] – translationLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateVersion.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    mockUpsert.mockResolvedValue({});
  });

  function expectNothingWritten(): void {
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreateVersion).not.toHaveBeenCalled();
  }

  it('returns 400 when translation is sent without translationLanguage', async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await PATCH(makePatchRequest({ translation: 'Nový překlad' }), routeContext);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('translationLanguage');
    expectNothingWritten();
  });

  it('returns 400 when translationLanguage is empty', async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await PATCH(
      makePatchRequest({ translation: 'Nový překlad', translationLanguage: '  ' }),
      routeContext,
    );

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it('does not save other fields from the same request when translationLanguage is missing', async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await PATCH(
      makePatchRequest({ transcription: 'Nový text', translation: 'Nový překlad' }),
      routeContext,
    );

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it.each([
    ['translation', { translation: null, translationLanguage: 'cs' }],
    ['translationLanguage', { translation: 'Nový překlad', translationLanguage: 42 }],
    ['transcription', { transcription: 123 }],
    ['context', { context: { text: 'x' } }],
  ])('returns 400 when %s is not a string', async (field, body) => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await PATCH(makePatchRequest(body), routeContext);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expectNothingWritten();
  });

  it('returns 400 for a non-object JSON body', async () => {
    const res = await PATCH(makePatchRequest(null), routeContext);

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it('saves translation when translationLanguage is provided', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC).mockResolvedValueOnce({
      ...FAKE_DOC,
      translations: [{ language: 'cs', text: 'Nový překlad' }],
    });

    const res = await PATCH(
      makePatchRequest({ translation: 'Nový překlad', translationLanguage: 'cs' }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { documentId_language: { documentId: 'doc-1', language: 'cs' } },
      update: { text: 'Nový překlad' },
      create: { documentId: 'doc-1', language: 'cs', text: 'Nový překlad' },
    });
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'translation:cs',
      'Český překlad',
      'manual_edit',
    );
  });

  it('bumps Document.updatedAt when only the translation changes (CLI conflict detection)', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC).mockResolvedValueOnce(FAKE_DOC);

    await PATCH(
      makePatchRequest({ translation: 'Nový překlad', translationLanguage: 'cs' }),
      routeContext,
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('does not bump updatedAt when the translation is unchanged', async () => {
    mockFindUnique.mockResolvedValueOnce(FAKE_DOC).mockResolvedValueOnce(FAKE_DOC);

    await PATCH(
      makePatchRequest({ translation: 'Český překlad', translationLanguage: 'cs' }),
      routeContext,
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('still accepts requests without translation (transcription only)', async () => {
    mockFindUnique
      .mockResolvedValueOnce(FAKE_DOC)
      .mockResolvedValueOnce({ ...FAKE_DOC, transcription: 'Nový text' });

    const res = await PATCH(makePatchRequest({ transcription: 'Nový text' }), routeContext);

    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { transcription: 'Nový text' },
    });
  });
});
