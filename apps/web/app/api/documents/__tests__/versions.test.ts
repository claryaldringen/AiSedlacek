import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────

const mockFindMany = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    documentVersion: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

// ── Helpers ──────────────────────────────────────────────

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1/versions', {
    method: 'GET',
  });
}

// ── Import route handler (after mocks) ──────────────────

import { GET } from '@/app/api/documents/[id]/versions/route';

// ── Tests ────────────────────────────────────────────────

describe('GET /api/documents/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns versions ordered by version desc', async () => {
    const fakeVersions = [
      {
        id: 'v-3',
        version: 3,
        field: 'translation:cs',
        source: 'ai_retranslate',
        model: 'claude-sonnet-4-6',
        createdAt: new Date('2026-03-17T12:00:00Z'),
        content: 'Verze 3',
      },
      {
        id: 'v-2',
        version: 2,
        field: 'translation:cs',
        source: 'ai_retranslate',
        model: 'claude-sonnet-4-6',
        createdAt: new Date('2026-03-17T11:00:00Z'),
        content: 'Verze 2',
      },
      {
        id: 'v-1',
        version: 1,
        field: 'translation:cs',
        source: 'ai_retranslate',
        model: 'claude-sonnet-4-6',
        createdAt: new Date('2026-03-17T10:00:00Z'),
        content: 'Verze 1',
      },
    ];
    mockFindMany.mockResolvedValue(fakeVersions);

    const res = await GET(makeRequest(), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(3);
    expect(json[0].id).toBe('v-3');
    expect(json[1].id).toBe('v-2');
    expect(json[2].id).toBe('v-1');

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        field: true,
        source: true,
        model: true,
        createdAt: true,
        content: true,
      },
    });
  });

  it('returns empty array when no versions exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest(), routeContext);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        field: true,
        source: true,
        model: true,
        createdAt: true,
        content: true,
      },
    });
  });
});
