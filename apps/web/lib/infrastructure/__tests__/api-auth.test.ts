import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    apiToken: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { resolveUserFromToken } from '../api-auth';

describe('resolveUserFromToken', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUpdate.mockResolvedValue({} as any);
  });

  it('returns null for missing header', async () => {
    const result = await resolveUserFromToken(null);
    expect(result).toBeNull();
  });

  it('returns null for invalid prefix', async () => {
    const result = await resolveUserFromToken('Basic abc');
    expect(result).toBeNull();
  });

  it('returns userId for valid token', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-123',
      tokenHash: 'hash',
      name: 'CLI',
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const result = await resolveUserFromToken('Bearer test-token-123');
    expect(result).toBe('user-123');
  });

  it('returns null for unknown token', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resolveUserFromToken('Bearer unknown');
    expect(result).toBeNull();
  });
});
