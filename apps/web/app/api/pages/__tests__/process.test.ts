import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockDocAggregate = vi.fn();
const mockDocFindUnique = vi.fn();
const mockDocCreate = vi.fn();
const mockPageFindUnique = vi.fn();
const mockPageUpdate = vi.fn();
const mockTranslationCreate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      aggregate: (...args: unknown[]) => mockDocAggregate(...args),
      findUnique: (...args: unknown[]) => mockDocFindUnique(...args),
      create: (...args: unknown[]) => mockDocCreate(...args),
    },
    page: {
      findUnique: (...args: unknown[]) => mockPageFindUnique(...args),
      update: (...args: unknown[]) => mockPageUpdate(...args),
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
vi.mock('@/lib/adapters/ocr/claude-vision', () => ({
  processWithClaude: (...args: unknown[]) => mockProcessWithClaude(...args),
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
    mockDocFindUnique.mockResolvedValue(null);
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
    mockDocFindUnique.mockResolvedValue(null);
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
    mockDocFindUnique.mockResolvedValue(null);

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
    mockDocFindUnique.mockResolvedValue(null);
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

  it('reuses cached document when hash matches existing document', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'page-1',
      imageUrl: '/api/images/test.jpg',
      document: null,
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    // Hash check returns existing document with matching translation
    mockDocFindUnique.mockResolvedValue({
      id: 'doc-existing',
      translations: [{ language: 'cs', text: 'Cached translation' }],
      glossary: [],
    });

    const res = await POST(makeRequest({ pageIds: ['page-1'], language: 'cs' }));

    const events = await consumeSSE(res);

    const pageDoneEvent = events.find((e) => e.event === 'page_done');
    expect(pageDoneEvent).toBeDefined();
    expect(pageDoneEvent!.data.documentId).toBe('doc-existing');
    expect(pageDoneEvent!.data.cached).toBe(true);

    // processWithClaude should NOT have been called
    expect(mockProcessWithClaude).not.toHaveBeenCalled();

    // Page status should be set to done
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { status: 'done' },
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
    mockDocFindUnique.mockResolvedValue(null);
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
