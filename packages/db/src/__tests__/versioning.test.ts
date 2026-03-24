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
});
