import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockDocAggregate = vi.fn();
const mockDocFindUnique = vi.fn();
const mockDocFindFirst = vi.fn();
const mockDocCreate = vi.fn();
const mockPageFindUnique = vi.fn();
const mockPageUpdate = vi.fn();
const mockPageFindMany = vi.fn();
const mockTranslationCreate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      aggregate: (...args: unknown[]) => mockDocAggregate(...args),
      findUnique: (...args: unknown[]) => mockDocFindUnique(...args),
      findFirst: (...args: unknown[]) => mockDocFindFirst(...args),
      create: (...args: unknown[]) => mockDocCreate(...args),
    },
    page: {
      findUnique: (...args: unknown[]) => mockPageFindUnique(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
      findMany: (...args: unknown[]) => mockPageFindMany(...args),
    },
    translation: {
      create: (...args: unknown[]) => mockTranslationCreate(...args),
    },
  },
}));

const mockCreateVersion = vi.fn();
vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
}));

const mockProcessWithClaude = vi.fn();
const mockProcessWithClaudeBatch = vi.fn();
vi.mock('@/lib/adapters/ocr/claude-vision', () => ({
  processWithClaude: (...args: unknown[]) => mockProcessWithClaude(...args),
  processWithClaudeBatch: (...args: unknown[]) => mockProcessWithClaudeBatch(...args),
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: vi.fn().mockResolvedValue({ balance: 1_000_000, sufficient: true }),
  deductTokensIfSufficient: vi.fn().mockResolvedValue({ success: true, balance: 999_000 }),
}));

vi.mock('@/lib/batch-utils', () => ({
  createBatches: vi.fn().mockImplementation((pages: { id: string }[]) => [pages]),
  estimateImageTokens: vi.fn().mockReturnValue(500),
  truncateContext: vi.fn().mockImplementation((text: string | undefined) => text),
}));

const mockReadFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: { readFile: (...args: unknown[]) => mockReadFile(...args) },
}));

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        digest: vi.fn().mockReturnValue('fakehash123'),
      }),
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pages/process', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function consumeSSE(
  response: Response,
): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.replace('event: ', '') ?? '';
      const dataLine = lines.find((l) => l.startsWith('data: '))?.replace('data: ', '') ?? '{}';
      return { event, data: JSON.parse(dataLine) as Record<string, unknown> };
    });
}

const CLAUDE_RESULT = {
  result: {
    transcription: 'Starý text',
    detectedLanguage: 'cs-old',
    translation: 'Překlad textu',
    translationLanguage: 'cs',
    context: 'Kontext dokumentu',
    glossary: [{ term: 'slovo', definition: 'význam' }],
  },
  rawResponse: '{"transcription":"Starý text"}',
  processingTimeMs: 100,
  model: 'claude-opus-4-6',
  inputTokens: 500,
  outputTokens: 200,
};

// ── Import route handler (after mocks) ──────────────────

import { POST } from '@/app/api/pages/process/route';

// ── Tests ────────────────────────────────────────────────

describe('POST /api/pages/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocAggregate.mockResolvedValue({ _avg: { outputTokens: 1500 } });
    mockPageUpdate.mockResolvedValue({});
    mockCreateVersion.mockResolvedValue(undefined);
    // Default: ownership check returns matching pages, other findMany calls return []
    mockPageFindMany.mockImplementation((args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      // Ownership check: has userId and id.in
      if (where?.userId && where?.id) {
        const idFilter = where.id as { in?: string[] };
        if (idFilter.in) {
          return Promise.resolve(idFilter.in.map((id: string) => ({ id })));
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

  it('skips pages that already have translation in target language', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: {
        id: 'doc-1',
        translations: [{ language: 'cs' }],
        glossary: [],
      },
    });

    const res = await POST(makeRequest({ pageIds: ['page-1'], language: 'cs' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const events = await consumeSSE(res);

    const skippedEvent = events.find((e) => e.event === 'page_skipped');
    expect(skippedEvent).toBeDefined();
    expect(skippedEvent!.data.pageId).toBe('page-1');
    expect(skippedEvent!.data.reason).toBe('Dokument již existuje s požadovaným jazykem');

    const doneEvent = events.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.total).toBe(1);
    expect(doneEvent!.data.completed).toBe(1);

    // Should NOT have called processWithClaude
    expect(mockProcessWithClaude).not.toHaveBeenCalled();
  });

  it('processes a new page successfully', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: null,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    // Hash check – no existing document with same hash
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValue({ id: 'doc-1' });

    const res = await POST(makeRequest({ pageIds: ['page-1'] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const events = await consumeSSE(res);

    // Should have page_progress events
    const progressEvents = events.filter((e) => e.event === 'page_progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0]!.data.pageId).toBe('page-1');

    // Should have page_done event
    const pageDoneEvent = events.find((e) => e.event === 'page_done');
    expect(pageDoneEvent).toBeDefined();
    expect(pageDoneEvent!.data.pageId).toBe('page-1');
    expect(pageDoneEvent!.data.documentId).toBe('doc-1');
    expect(pageDoneEvent!.data.cached).toBe(false);

    // Should have final done event
    const doneEvent = events.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.total).toBe(1);
    expect(doneEvent!.data.completed).toBe(1);

    // Verify page status was set to 'processing' then 'done'
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'processing', errorMessage: null },
    });
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'done', errorMessage: null },
    });

    // Verify document was created
    expect(mockDocCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: 'page-1',
          hash: 'fakehash123',
          transcription: 'Starý text',
          detectedLanguage: 'cs-old',
        }),
      }),
    );

    // Verify versions were created
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'transcription',
      'Starý text',
      'ai_initial',
      'claude-opus-4-6',
    );
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'translation:cs',
      'Překlad textu',
      'ai_initial',
      'claude-opus-4-6',
    );
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'context',
      'Kontext dokumentu',
      'ai_initial',
      'claude-opus-4-6',
    );
  });

  it('handles page processing errors gracefully and continues to next page', async () => {
    // First page will fail (page not found), second page will succeed
    mockPageFindUnique
      .mockResolvedValueOnce(null) // page-1: not found
      .mockResolvedValueOnce({
        // page-2: found
        id: 'page-2',
        imageUrl: '/api/images/test2.jpg',
        document: null,
      });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValue({ id: 'doc-2' });

    const res = await POST(makeRequest({ pageIds: ['page-1', 'page-2'] }));

    expect(res.status).toBe(200);

    const events = await consumeSSE(res);

    // page-1 should have an error event
    const errorEvent = events.find((e) => e.event === 'page_error' && e.data.pageId === 'page-1');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toBe('Stránka nenalezena');

    // page-2 should be processed successfully
    const pageDoneEvent = events.find((e) => e.event === 'page_done' && e.data.pageId === 'page-2');
    expect(pageDoneEvent).toBeDefined();
    expect(pageDoneEvent!.data.documentId).toBe('doc-2');

    // Final done event should indicate both pages completed
    const doneEvent = events.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data.total).toBe(2);
    expect(doneEvent!.data.completed).toBe(2);
  });

  it('sends page_error when processWithClaude throws', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: null,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockProcessWithClaude.mockRejectedValue(new Error('Claude API timeout'));
    mockDocFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ pageIds: ['page-1'] }));

    const events = await consumeSSE(res);

    const errorEvent = events.find((e) => e.event === 'page_error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.pageId).toBe('page-1');
    expect(errorEvent!.data.error).toBe('Claude API timeout');

    // Should still have the final done event
    const doneEvent = events.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();

    // Page status should be set to error
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'error', errorMessage: 'Claude API timeout' },
    });
  });

  it('defaults target language to cs when not provided', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: null,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValue({ id: 'doc-1' });

    const res = await POST(makeRequest({ pageIds: ['page-1'] }));

    const events = await consumeSSE(res);
    const pageDoneEvent = events.find((e) => e.event === 'page_done');
    expect(pageDoneEvent).toBeDefined();

    // Document creation should use default language 'cs' in translation
    expect(mockDocCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          translations: {
            create: {
              language: 'cs',
              text: 'Překlad textu',
            },
          },
        }),
      }),
    );
  });

  it('copies cached document when hash matches existing document from another user', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: null,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    // Hash check returns existing document (from any user) with full data for copying
    mockDocFindFirst.mockResolvedValue({
      id: 'doc-existing',
      hash: 'fakehash123',
      rawResponse: '{"transcription":"Cached"}',
      transcription: 'Cached transcription',
      detectedLanguage: 'cs-old',
      context: 'Cached context',
      model: 'claude-opus-4-6',
      inputTokens: 500,
      outputTokens: 200,
      processingTimeMs: 100,
      translations: [
        {
          language: 'cs',
          text: 'Cached translation',
          model: null,
          inputTokens: null,
          outputTokens: null,
        },
      ],
      glossary: [{ term: 'slovo', definition: 'význam' }],
    });
    // copyDocumentForPage will call prisma.document.create
    mockDocCreate.mockResolvedValue({ id: 'doc-copy' });

    const res = await POST(makeRequest({ pageIds: ['page-1'], language: 'cs' }));

    const events = await consumeSSE(res);

    const pageDoneEvent = events.find((e) => e.event === 'page_done');
    expect(pageDoneEvent).toBeDefined();
    expect(pageDoneEvent!.data.documentId).toBe('doc-copy');
    expect(pageDoneEvent!.data.cached).toBe(true);

    // processWithClaude should NOT have been called
    expect(mockProcessWithClaude).not.toHaveBeenCalled();

    // A new document should have been created (copy)
    expect(mockDocCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: 'page-1',
          hash: 'fakehash123',
          transcription: 'Cached transcription',
        }),
      }),
    );

    // Page status should be set to done
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('adds translation to existing document without re-creating it', async () => {
    const existingDoc = {
      id: 'doc-existing',
      translations: [{ language: 'en' }],
      glossary: [],
    };
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: existingDoc,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    // Hash check returns null (no duplicate by hash)
    mockDocFindFirst.mockResolvedValue(null);
    mockTranslationCreate.mockResolvedValue({});

    const res = await POST(makeRequest({ pageIds: ['page-1'], language: 'cs' }));

    const events = await consumeSSE(res);

    const pageDoneEvent = events.find((e) => e.event === 'page_done');
    expect(pageDoneEvent).toBeDefined();
    expect(pageDoneEvent!.data.documentId).toBe('doc-existing');

    // Should create a new translation, not a new document
    expect(mockTranslationCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-existing',
        language: 'cs',
        text: 'Překlad textu',
      },
    });
    expect(mockDocCreate).not.toHaveBeenCalled();
  });

  it('sends page_error for non-string pageIds', async () => {
    const res = await POST(makeRequest({ pageIds: [123, 'page-2'] }));

    // Should be an SSE stream
    expect(res.status).toBe(200);

    // Mock for the valid page
    mockPageFindUnique.mockResolvedValue(null);

    const events = await consumeSSE(res);

    // Should have error for numeric pageId
    const errorEvent = events.find((e) => e.event === 'page_error' && e.data.pageId === 123);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.error).toBe('Neplatné ID stránky');
  });
});

// ── Batch processing tests ──────────────────────────────

const BATCH_CLAUDE_RESULT = {
  results: [
    {
      index: 0,
      result: {
        transcription: 'Text 0',
        detectedLanguage: 'cs-old',
        translation: 'Překlad 0',
        translationLanguage: 'cs',
        context: 'Kontext 0',
        glossary: [{ term: 'slovo', definition: 'význam' }],
      },
    },
    {
      index: 1,
      result: {
        transcription: 'Text 1',
        detectedLanguage: 'cs-old',
        translation: 'Překlad 1',
        translationLanguage: 'cs',
        context: 'Kontext 1',
        glossary: [],
      },
    },
  ],
  rawResponse: '{"imageIndex":0,...}\n{"imageIndex":1,...}',
  processingTimeMs: 200,
  model: 'claude-opus-4-6',
  inputTokens: 1000,
  outputTokens: 400,
};

describe('batch processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocAggregate.mockResolvedValue({ _avg: { outputTokens: 1500 } });
    mockPageUpdate.mockResolvedValue({});
    mockCreateVersion.mockResolvedValue(undefined);
    // Default: ownership check returns matching pages, other findMany calls return []
    mockPageFindMany.mockImplementation((args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      if (where?.userId && where?.id) {
        const idFilter = where.id as { in?: string[] };
        if (idFilter.in) {
          return Promise.resolve(idFilter.in.map((id: string) => ({ id })));
        }
      }
      return Promise.resolve([]);
    });
  });

  it('sends batch_info event for multi-page batch', async () => {
    mockPageFindUnique
      .mockResolvedValueOnce({
        id: 'p1',
        imageUrl: '/api/images/a.jpg',
        fileSize: 400000,
        document: null,
        collection: null,
      })
      .mockResolvedValueOnce({
        id: 'p2',
        imageUrl: '/api/images/b.jpg',
        fileSize: 400000,
        document: null,
        collection: null,
      });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValueOnce({ id: 'doc-1' }).mockResolvedValueOnce({ id: 'doc-2' });
    mockProcessWithClaudeBatch.mockResolvedValue(BATCH_CLAUDE_RESULT);

    const res = await POST(makeRequest({ pageIds: ['p1', 'p2'] }));
    const events = await consumeSSE(res);

    const batchInfoEvent = events.find((e) => e.event === 'batch_info');
    expect(batchInfoEvent).toBeDefined();
    expect(batchInfoEvent!.data.batchNumber).toBe(1);
    expect(batchInfoEvent!.data.totalBatches).toBe(1);
    expect(batchInfoEvent!.data.pageCount).toBe(2);

    const pageDoneEvents = events.filter((e) => e.event === 'page_done');
    expect(pageDoneEvents).toHaveLength(2);
  });

  it('falls back to individual processing on batch failure', async () => {
    mockPageFindUnique
      .mockResolvedValueOnce({
        id: 'p1',
        imageUrl: '/api/images/a.jpg',
        fileSize: 400000,
        document: null,
        collection: null,
      })
      .mockResolvedValueOnce({
        id: 'p2',
        imageUrl: '/api/images/b.jpg',
        fileSize: 400000,
        document: null,
        collection: null,
      });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValueOnce({ id: 'doc-1' }).mockResolvedValueOnce({ id: 'doc-2' });
    // Batch fails
    mockProcessWithClaudeBatch.mockRejectedValue(new Error('API Error'));
    // Individual succeeds
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);

    const res = await POST(makeRequest({ pageIds: ['p1', 'p2'] }));
    const events = await consumeSSE(res);

    // Should have fallen back to individual processing
    expect(mockProcessWithClaude).toHaveBeenCalledTimes(2);
    const pageDoneEvents = events.filter((e) => e.event === 'page_done');
    expect(pageDoneEvents).toHaveLength(2);
  });

  it('adds previous page context for single-page processing', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'p3',
      imageUrl: '/api/images/c.jpg',
      fileSize: 400000,
      document: null,
      collection: { id: 'col-1', context: null },
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindFirst.mockResolvedValue(null);
    mockDocCreate.mockResolvedValue({ id: 'doc-3' });
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    // Ownership check returns matching pages; context query returns previous pages
    mockPageFindMany.mockImplementation((args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      if (where?.userId && where?.id) {
        const idFilter = where.id as { in?: string[] };
        if (idFilter.in) {
          return Promise.resolve(idFilter.in.map((id: string) => ({ id })));
        }
      }
      // Context query: has collectionId and document.isNot
      if (where?.collectionId) {
        return Promise.resolve([
          { id: 'prev-1', document: { transcription: 'Předchozí text stránky 1' } },
          { id: 'prev-2', document: { transcription: 'Předchozí text stránky 2' } },
        ]);
      }
      return Promise.resolve([]);
    });

    const res = await POST(makeRequest({ pageIds: ['p3'] }));
    await consumeSSE(res);

    // processWithClaude should have been called with previousContext (5th arg)
    expect(mockProcessWithClaude).toHaveBeenCalled();
    const callArgs = mockProcessWithClaude.mock.calls[0]!;
    expect(callArgs[4]).toContain('Předchozí text stránky 1');
    expect(callArgs[4]).toContain('Předchozí text stránky 2');
  });
});
