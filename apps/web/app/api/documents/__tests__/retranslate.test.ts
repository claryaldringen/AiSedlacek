import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    translation: { upsert: (...args: unknown[]) => mockUpsert(...args) },
  },
}));

const mockCreateVersion = vi.fn();
vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
}));

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: (...args: unknown[]) => mockMessagesCreate(...args) };
    },
  };
});

vi.mock('@/lib/infrastructure/billing', () => ({
  checkBalance: vi.fn().mockResolvedValue({ balance: 1_000_000, sufficient: true }),
  deductTokensIfSufficient: vi.fn().mockResolvedValue({ success: true, balance: 999_000 }),
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

const CLAUDE_RESPONSE = {
  content: [{ type: 'text' as const, text: 'Přeložený text' }],
  model: 'claude-sonnet-4-6',
  usage: { input_tokens: 100, output_tokens: 50 },
};

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
    mockMessagesCreate.mockResolvedValue(CLAUDE_RESPONSE);
    mockUpsert.mockResolvedValue({});
    mockCreateVersion.mockResolvedValue(undefined);
  });

  it('returns 404 when document not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ language: 'cs' }), routeContext);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Dokument nenalezen');
  });

  it('creates version from previous translation before overwriting', async () => {
    mockFindUnique.mockResolvedValue({ ...FAKE_DOC, translations: [] });

    const req = makeRequest({
      language: 'cs',
      previousTranslation: 'Starý překlad',
    });
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);

    // createVersion should be called with the previousTranslation content
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'translation:cs',
      'Starý překlad',
      'ai_retranslate',
      'claude-sonnet-4-6',
    );

    // And it should be called before the upsert
    const versionCallOrder = mockCreateVersion.mock.invocationCallOrder[0]!;
    const upsertCallOrder = mockUpsert.mock.invocationCallOrder[0]!;
    expect(versionCallOrder).toBeLessThan(upsertCallOrder);
  });

  it('upserts translation with Claude result', async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await POST(makeRequest({ language: 'cs' }), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translation).toBe('Přeložený text');
    expect(json.language).toBe('cs');

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { documentId_language: { documentId: 'doc-1', language: 'cs' } },
      update: {
        text: 'Přeložený text',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      },
      create: {
        documentId: 'doc-1',
        language: 'cs',
        text: 'Přeložený text',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      },
    });
  });

  it("defaults to 'cs' language when not provided", async () => {
    mockFindUnique.mockResolvedValue(FAKE_DOC);

    const res = await POST(makeRequest({}), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.language).toBe('cs');

    // Verify findUnique was called looking for 'cs' translations
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      include: {
        translations: { where: { language: 'cs' } },
        page: { select: { userId: true } },
      },
    });
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
