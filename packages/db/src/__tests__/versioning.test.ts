import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../client', () => ({
  prisma: {
    documentVersion: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../client';
import { createVersion } from '../versioning';

const mockFindFirst = prisma.documentVersion.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = prisma.documentVersion.create as ReturnType<typeof vi.fn>;

describe('createVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates version 1 when no prior versions exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    await createVersion('doc-1', 'consolidatedText', 'Hello', 'claude', 'opus');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-1',
        version: 1,
        field: 'consolidatedText',
        content: 'Hello',
        source: 'claude',
        model: 'opus',
      },
    });
  });

  it('increments from existing version 3 to version 4', async () => {
    mockFindFirst.mockResolvedValue({ version: 3 });
    mockCreate.mockResolvedValue({});

    await createVersion('doc-2', 'polishedTranslation', 'Translated', 'user');

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-2',
        version: 4,
        field: 'polishedTranslation',
        content: 'Translated',
        source: 'user',
        model: undefined,
      },
    });
  });

  it('passes model as undefined when not provided', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    await createVersion('doc-3', 'literalTranslation', 'Literal text', 'ollama');

    const createCall = mockCreate.mock.calls[0]![0];
    expect(createCall.data.model).toBeUndefined();
  });

  it('retries on a unique-constraint collision (concurrent writers race)', async () => {
    // First attempt reads version 3, tries to create 4 → loses the race (P2002).
    // Second attempt re-reads (now 4) and creates 5.
    mockFindFirst.mockResolvedValueOnce({ version: 3 }).mockResolvedValueOnce({ version: 4 });
    mockCreate
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockResolvedValueOnce({});

    await createVersion('doc-race', 'consolidatedText', 'x', 'claude');

    expect(mockFindFirst).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1]![0].data.version).toBe(5);
  });

  it('gives up after repeated collisions and rethrows', async () => {
    mockFindFirst.mockResolvedValue({ version: 1 });
    mockCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(createVersion('doc-x', 'f', 'c', 's')).rejects.toMatchObject({ code: 'P2002' });
  });
});
