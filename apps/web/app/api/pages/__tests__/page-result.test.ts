import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/pages/[id]/result (agentní OCR přes `ais submit`): typy těla se
// validují před zápisem a dokument, překlad, glosář, verze i stav stránky se
// zapisují v jedné transakci – nevalidní vstup nesmí nechat stránku uvízlou.

// ── Mocks ────────────────────────────────────────────────

const mockPageFindUnique = vi.fn();
const mockDocumentCreate = vi.fn();
const mockVersionCreateMany = vi.fn();
const mockPageUpdateMany = vi.fn();

const txMock = {
  document: { create: (...args: unknown[]) => mockDocumentCreate(...args) },
  documentVersion: { createMany: (...args: unknown[]) => mockVersionCreateMany(...args) },
  page: { updateMany: (...args: unknown[]) => mockPageUpdateMany(...args) },
};
const mockTransaction = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: { findUnique: (...args: unknown[]) => mockPageFindUnique(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  resolveUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { POST } from '@/app/api/pages/[id]/result/route';

// ── Helpers ──────────────────────────────────────────────

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pages/page-1/result', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
  });
}

const ctx = { params: Promise.resolve({ id: 'page-1' }) };

const PAGE = { id: 'page-1', userId: 'user-1', status: 'pending', hash: 'hash-1' };

const VALID_BODY = {
  transcription: 'Ich bekenne',
  translation: 'Vyznávám',
  detectedLanguage: 'de',
  translationLanguage: 'en',
  context: 'Listina z roku 1420',
  glossary: [{ term: 'bekennen', definition: 'vyznávat' }],
  model: 'claude-agent-cli',
  processingTimeMs: 1234,
};

function expectNothingWritten(): void {
  expect(mockTransaction).not.toHaveBeenCalled();
  expect(mockDocumentCreate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPageFindUnique.mockResolvedValue(PAGE);
  mockDocumentCreate.mockResolvedValue({ id: 'doc-1' });
  mockVersionCreateMany.mockResolvedValue({ count: 3 });
  mockPageUpdateMany.mockResolvedValue({ count: 1 });
  mockTransaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
});

// ── Tests ────────────────────────────────────────────────

describe('POST /api/pages/[id]/result', () => {
  it('writes document, translation, glossary, versions and page status in one transaction', async () => {
    const res = await POST(post(VALID_BODY), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentId: 'doc-1', status: 'done' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    expect(mockDocumentCreate).toHaveBeenCalledWith({
      data: {
        pageId: 'page-1',
        hash: 'hash-1',
        transcription: 'Ich bekenne',
        detectedLanguage: 'de',
        context: 'Listina z roku 1420',
        model: 'claude-agent-cli',
        processingTimeMs: 1234,
        translations: {
          create: { language: 'en', text: 'Vyznávám', context: 'Listina z roku 1420' },
        },
        glossary: { create: [{ term: 'bekennen', definition: 'vyznávat' }] },
      },
      select: { id: true },
    });
    expect(mockVersionCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ version: 1, field: 'transcription', source: 'ai_initial' }),
        expect.objectContaining({ version: 2, field: 'translation:en', content: 'Vyznávám' }),
        expect.objectContaining({ version: 3, field: 'context', model: 'claude-agent-cli' }),
      ],
    });
    // Archivovanou stránku zápis výsledku neodarchivuje.
    expect(mockPageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'page-1', status: { not: 'archived' } },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('applies defaults for optional fields', async () => {
    const res = await POST(post({ transcription: 'Text', translation: 'Překlad' }), ctx);

    expect(res.status).toBe(200);
    expect(mockDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        detectedLanguage: 'unknown',
        context: '',
        model: 'claude-cli',
        processingTimeMs: null,
        translations: { create: { language: 'cs', text: 'Překlad', context: '' } },
        glossary: { create: [] },
      }),
      select: { id: true },
    });
    // Bez kontextu jen dvě verze
    expect(mockVersionCreateMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it.each([
    ['glossary', { glossary: [{ term: 'x' }] }],
    ['glossary', { glossary: [{ term: 'x', definition: 42 }] }],
    ['glossary', { glossary: 'bekennen: vyznávat' }],
    ['transcription', { transcription: ['Ich'] }],
    ['translation', { translation: 42 }],
    ['translationLanguage', { translationLanguage: 7 }],
    ['detectedLanguage', { detectedLanguage: { code: 'de' } }],
    ['context', { context: 1 }],
    ['model', { model: true }],
    ['processingTimeMs', { processingTimeMs: '1234' }],
    ['processingTimeMs', { processingTimeMs: -1 }],
  ])('returns 400 when %s has an invalid type and writes nothing', async (field, patch) => {
    const res = await POST(post({ ...VALID_BODY, ...patch }), ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expectNothingWritten();
  });

  it('rounds fractional processingTimeMs (Int column)', async () => {
    await POST(post({ ...VALID_BODY, processingTimeMs: 1234.6 }), ctx);

    expect(mockDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ processingTimeMs: 1235 }),
      select: { id: true },
    });
  });

  it('returns 400 for empty transcription or translation', async () => {
    const res = await POST(post({ ...VALID_BODY, translation: '   ' }), ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('transcription a translation jsou povinné');
    expectNothingWritten();
  });

  it('returns 400 for an unsupported translation language', async () => {
    const res = await POST(post({ ...VALID_BODY, translationLanguage: 'klingon' }), ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Nepodporovaný jazyk překladu');
    expectNothingWritten();
  });

  it('returns 400 for invalid JSON and non-object bodies', async () => {
    expect((await POST(post('{nope'), ctx)).status).toBe(400);
    expect((await POST(post([VALID_BODY]), ctx)).status).toBe(400);
    expectNothingWritten();
  });

  it('returns 404 for a page of another user', async () => {
    mockPageFindUnique.mockResolvedValue({ ...PAGE, userId: 'user-2' });

    const res = await POST(post(VALID_BODY), ctx);

    expect(res.status).toBe(404);
    expectNothingWritten();
  });

  it.each([
    ['done', 'Stránka už byla zpracována'],
    ['archived', 'Stránka je smazaná'],
  ])('returns 409 for a %s page', async (status, message) => {
    mockPageFindUnique.mockResolvedValue({ ...PAGE, status });

    const res = await POST(post(VALID_BODY), ctx);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
    expectNothingWritten();
  });

  it('returns 409 when a document for the page already exists (unique pageId)', async () => {
    mockTransaction.mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002' }));

    const res = await POST(post(VALID_BODY), ctx);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Stránka už byla zpracována');
  });
});
