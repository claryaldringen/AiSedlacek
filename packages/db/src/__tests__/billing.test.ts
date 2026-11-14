import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../client', () => ({
  prisma: {
    tokenTransaction: {
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../client';
import { createTransaction, czkToTokens, generateVariableSymbol } from '../billing';

const mockCreate = prisma.tokenTransaction.create as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.tokenTransaction.findFirst as ReturnType<typeof vi.fn>;
const mockUserFindFirst = prisma.user.findFirst as ReturnType<typeof vi.fn>;

describe('billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('creates a transaction with the correct data', async () => {
      const txData = {
        userId: 'user-1',
        type: 'topup_stripe' as const,
        amount: 50000,
        description: 'Stripe top-up',
        referenceId: 'stripe_pi_123',
        amountCzk: 250,
      };
      const createdTx = { id: 'tx-1', ...txData, createdAt: new Date() };
      mockCreate.mockResolvedValue(createdTx);
      const result = await createTransaction(txData);
      expect(result).toEqual(createdTx);
      expect(mockCreate).toHaveBeenCalledWith({ data: txData });
    });

    it('creates a transaction without optional fields', async () => {
      const txData = {
        userId: 'user-1',
        type: 'consumption' as const,
        amount: -1000,
        description: 'OCR processing',
      };
      mockCreate.mockResolvedValue({ id: 'tx-2', ...txData });
      const result = await createTransaction(txData);
      expect(result.id).toBe('tx-2');
      expect(mockCreate).toHaveBeenCalledWith({ data: txData });
    });

    it('handles P2002 idempotency — returns existing transaction on duplicate referenceId', async () => {
      const existingTx = {
        id: 'tx-existing',
        userId: 'user-1',
        type: 'topup_bank',
        amount: 100000,
        referenceId: 'bank_ref_456',
      };
      const p2002Error = { code: 'P2002', message: 'Unique constraint violation' };
      mockCreate.mockRejectedValue(p2002Error);
      mockFindFirst.mockResolvedValue(existingTx);
      const result = await createTransaction({
        userId: 'user-1',
        type: 'topup_bank',
        amount: 100000,
        description: 'Bank top-up',
        referenceId: 'bank_ref_456',
      });
      expect(result).toEqual(existingTx);
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', referenceId: 'bank_ref_456' },
      });
    });

    it('re-throws P2002 error when referenceId is not provided', async () => {
      const p2002Error = { code: 'P2002', message: 'Unique constraint violation' };
      mockCreate.mockRejectedValue(p2002Error);
      await expect(
        createTransaction({
          userId: 'user-1',
          type: 'consumption',
          amount: -500,
          description: 'OCR processing',
        }),
      ).rejects.toEqual(p2002Error);
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('re-throws P2002 error when existing transaction is not found', async () => {
      const p2002Error = { code: 'P2002', message: 'Unique constraint violation' };
      mockCreate.mockRejectedValue(p2002Error);
      mockFindFirst.mockResolvedValue(null);
      await expect(
        createTransaction({
          userId: 'user-1',
          type: 'topup_bank',
          amount: 100000,
          description: 'Bank top-up',
          referenceId: 'bank_ref_ghost',
        }),
      ).rejects.toEqual(p2002Error);
    });

    it('re-throws non-P2002 errors', async () => {
      const genericError = new Error('Database connection failed');
      mockCreate.mockRejectedValue(genericError);
      await expect(
        createTransaction({
          userId: 'user-1',
          type: 'topup_stripe',
          amount: 50000,
          description: 'Stripe top-up',
          referenceId: 'stripe_pi_789',
        }),
      ).rejects.toThrow('Database connection failed');
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('re-throws when error is not an object with code', async () => {
      mockCreate.mockRejectedValue('string error');
      await expect(
        createTransaction({
          userId: 'user-1',
          type: 'consumption',
          amount: -100,
          description: 'test',
          referenceId: 'ref-1',
        }),
      ).rejects.toBe('string error');
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('re-throws null errors', async () => {
      mockCreate.mockRejectedValue(null);
      await expect(
        createTransaction({
          userId: 'user-1',
          type: 'consumption',
          amount: -100,
          description: 'test',
          referenceId: 'ref-1',
        }),
      ).rejects.toBe(null);
    });
  });

  describe('czkToTokens', () => {
    it('converts halire to tokens correctly', () => {
      expect(czkToTokens(100)).toBe(20000);
    });

    it('converts larger amounts', () => {
      expect(czkToTokens(5000)).toBe(1000000);
    });

    it('returns 0 for 0 halire', () => {
      expect(czkToTokens(0)).toBe(0);
    });

    it('floors the result for non-integer token amounts', () => {
      expect(czkToTokens(1)).toBe(200);
      expect(czkToTokens(3)).toBe(600);
    });

    it('handles typical payment amounts', () => {
      expect(czkToTokens(10000)).toBe(2000000);
      expect(czkToTokens(25000)).toBe(5000000);
    });

    it('floors partial tokens from odd halire values', () => {
      expect(czkToTokens(7)).toBe(1400);
      expect(czkToTokens(33)).toBe(6600);
    });
  });

  describe('generateVariableSymbol', () => {
    it('returns a number in the range 100000–999999', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      const vs = await generateVariableSymbol();
      expect(vs).toBeGreaterThanOrEqual(100000);
      expect(vs).toBeLessThanOrEqual(999999);
    });

    it('returns on first attempt when no collision', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      await generateVariableSymbol();
      expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
    });

    it('retries on collision and returns a unique symbol', async () => {
      mockUserFindFirst
        .mockResolvedValueOnce({ id: 'existing-1' })
        .mockResolvedValueOnce({ id: 'existing-2' })
        .mockResolvedValueOnce(null);
      const vs = await generateVariableSymbol();
      expect(mockUserFindFirst).toHaveBeenCalledTimes(3);
      expect(vs).toBeGreaterThanOrEqual(100000);
      expect(vs).toBeLessThanOrEqual(999999);
    });

    it('throws after 100 failed attempts', async () => {
      mockUserFindFirst.mockResolvedValue({ id: 'always-exists' });
      await expect(generateVariableSymbol()).rejects.toThrow(
        'Nepodařilo se vygenerovat unikátní variabilní symbol',
      );
      expect(mockUserFindFirst).toHaveBeenCalledTimes(100);
    });

    it('queries user table with the generated variableSymbol', async () => {
      mockUserFindFirst.mockResolvedValue(null);
      const vs = await generateVariableSymbol();
      expect(mockUserFindFirst).toHaveBeenCalledWith({
        where: { variableSymbol: vs },
      });
    });
  });
});
