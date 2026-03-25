import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockPublicSlugFindUnique = vi.fn();
const mockCollectionFindUnique = vi.fn();
const mockPageFindUnique = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    publicSlug: {
      findUnique: (...args: unknown[]) => mockPublicSlugFindUnique(...args),
    },
    collection: {
      findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args),
    },
    page: {
      findUnique: (...args: unknown[]) => mockPageFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn(),
  getCurrentUserId: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('next-auth', () => ({ default: vi.fn() }));
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────

function makeRequest(slug: string): NextRequest {
  return new NextRequest(new Request(`http://localhost/api/public/${slug}`, { method: 'GET' }));
}

function routeContext(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

// ── Fixtures ─────────────────────────────────────────────

const FAKE_COLLECTION = {
  id: 'col-1',
  name: 'Testovací svazek',
  description: 'Popis svazku',
  context: 'Historický kontext',
  isPublic: true,
  slug: 'testovaci-svazek',
  pages: [
    {
      id: 'page-1',
      displayName: 'Stránka 1',
      thumbnailUrl: '/api/images/thumb-1.jpg',
      imageUrl: '/api/images/page-1.jpg',
      status: 'done',
      order: 0,
      document: {
        transcription: 'Text rukopisu...',
        detectedLanguage: 'de',
        context: 'Kontext dokumentu',
        translations: [{ language: 'cs', text: 'Překlad textu...' }],
        glossary: [{ term: 'archaické slovo', definition: 'Vysvětlení' }],
      },
    },
  ],
};

const FAKE_PAGE = {
  id: 'page-2',
  displayName: 'Jednotlivá stránka',
  imageUrl: '/api/images/page-2.jpg',
  thumbnailUrl: '/api/images/thumb-2.jpg',
  status: 'done',
  isPublic: true,
  slug: 'jednotliva-stranka',
  document: {
    transcription: 'Text jednotlivé stránky...',
    detectedLanguage: 'la',
    context: 'Latinský text',
    translations: [{ language: 'cs', text: 'Překlad latinského textu...' }],
    glossary: [{ term: 'terminus', definition: 'Latinský termín' }],
  },
};

// ── Import route handlers (after mocks) ──────────────────

import { GET } from '@/app/api/public/[slug]/route';

// ── Tests ─────────────────────────────────────────────────

describe('GET /api/public/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when slug does not exist', async () => {
    mockPublicSlugFindUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('neexistujici-slug'), routeContext('neexistujici-slug'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns collection with pages when slug targets a public collection', async () => {
    mockPublicSlugFindUnique.mockResolvedValue({
      slug: 'testovaci-svazek',
      targetType: 'collection',
      targetId: 'col-1',
      createdAt: new Date(),
    });
    mockCollectionFindUnique.mockResolvedValue(FAKE_COLLECTION);

    const res = await GET(makeRequest('testovaci-svazek'), routeContext('testovaci-svazek'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('collection');
    expect(json.name).toBe('Testovací svazek');
    expect(json.description).toBe('Popis svazku');
    expect(json.context).toBe('Historický kontext');
    expect(Array.isArray(json.pages)).toBe(true);
    expect(json.pages).toHaveLength(1);
    expect(json.pages[0].id).toBe('page-1');
    expect(json.pages[0].document.transcription).toBe('Text rukopisu...');
    // Sensitive fields must NOT be present
    expect(json.userId).toBeUndefined();
    expect(json.contextUrls).toBeUndefined();
    expect(json.pages[0].hash).toBeUndefined();
    expect(json.pages[0].fileSize).toBeUndefined();
    expect(json.pages[0].mimeType).toBeUndefined();
    expect(json.pages[0].document?.inputTokens).toBeUndefined();
    expect(json.pages[0].document?.outputTokens).toBeUndefined();
    expect(json.pages[0].document?.processingTimeMs).toBeUndefined();
    expect(json.pages[0].document?.model).toBeUndefined();
    expect(json.pages[0].document?.rawResponse).toBeUndefined();
    expect(json.pages[0].document?.batchId).toBeUndefined();
  });

  it('returns 404 when collection exists but isPublic is false', async () => {
    mockPublicSlugFindUnique.mockResolvedValue({
      slug: 'privatni-svazek',
      targetType: 'collection',
      targetId: 'col-2',
      createdAt: new Date(),
    });
    mockCollectionFindUnique.mockResolvedValue({
      ...FAKE_COLLECTION,
      id: 'col-2',
      isPublic: false,
    });

    const res = await GET(makeRequest('privatni-svazek'), routeContext('privatni-svazek'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('returns page when slug targets a public page', async () => {
    mockPublicSlugFindUnique.mockResolvedValue({
      slug: 'jednotliva-stranka',
      targetType: 'page',
      targetId: 'page-2',
      createdAt: new Date(),
    });
    mockPageFindUnique.mockResolvedValue(FAKE_PAGE);

    const res = await GET(makeRequest('jednotliva-stranka'), routeContext('jednotliva-stranka'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('page');
    expect(json.displayName).toBe('Jednotlivá stránka');
    expect(json.imageUrl).toBe('/api/images/page-2.jpg');
    expect(json.status).toBe('done');
    expect(json.document.transcription).toBe('Text jednotlivé stránky...');
    expect(json.document.translations).toHaveLength(1);
    expect(json.document.glossary).toHaveLength(1);
    // Sensitive fields must NOT be present
    expect(json.userId).toBeUndefined();
    expect(json.hash).toBeUndefined();
    expect(json.fileSize).toBeUndefined();
    expect(json.mimeType).toBeUndefined();
    expect(json.document?.inputTokens).toBeUndefined();
    expect(json.document?.outputTokens).toBeUndefined();
    expect(json.document?.processingTimeMs).toBeUndefined();
    expect(json.document?.model).toBeUndefined();
    expect(json.document?.rawResponse).toBeUndefined();
    expect(json.document?.batchId).toBeUndefined();
  });

  it('returns 404 when page exists but isPublic is false', async () => {
    mockPublicSlugFindUnique.mockResolvedValue({
      slug: 'privatni-stranka',
      targetType: 'page',
      targetId: 'page-3',
      createdAt: new Date(),
    });
    mockPageFindUnique.mockResolvedValue({ ...FAKE_PAGE, id: 'page-3', isPublic: false });

    const res = await GET(makeRequest('privatni-stranka'), routeContext('privatni-stranka'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
