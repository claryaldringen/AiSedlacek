import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
  prisma: {
    tokenTransaction: {
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '../db';
import {
  getTokenBalance,
  checkBalance,
  createTransaction,
  deductTokens,
  czkToTokens,
  generateVariableSymbol,
} from '../billing';

const mockAggregate = prisma.tokenTransaction.aggregate as ReturnType<typeof vi.fn>;
const mockCreate = prisma.tokenTransaction.create as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.tokenTransaction.findFirst as ReturnType<typeof vi.fn>;
const mockUserFindFirst = prisma.user.findFirst as ReturnType<typeof vi.fn>;

describe('billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getTokenBalance
  // ---------------------------------------------------------------------------
  describe('getTokenBalance', () => {
    it('returns 0 when there are no transactions (sum is null)', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: null } });

      const balance = await getTokenBalance('user-1');

      expect(balance).toBe(0);
      expect(mockAggregate).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        _sum: { amount: true },
      });
    });

    it('returns the summed balance from aggregate', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: 42000 } });

      const balance = await getTokenBalance('user-2');

      expect(balance).toBe(42000);
    });

    it('returns negative balance when consumption exceeds top-ups', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: -500 } });

      const balance = await getTokenBalance('user-3');

      expect(balance).toBe(-500);
    });
  });

  // ---------------------------------------------------------------------------
  // checkBalance
  // ---------------------------------------------------------------------------
  describe('checkBalance', () => {
    it('returns sufficient: true when balance is positive', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: 10000 } });

      const result = await checkBalance('user-1');

      expect(result).toEqual({ balance: 10000, sufficient: true });
    });

    it('returns sufficient: false when balance is zero', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await checkBalance('user-2');

      expect(result).toEqual({ balance: 0, sufficient: false });
    });

    it('returns sufficient: false when balance is negative', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: -100 } });

      const result = await checkBalance('user-3');

      expect(result).toEqual({ balance: -100, sufficient: false });
    });

    it('returns sufficient: false when no transactions exist (balance 0)', async () => {
      mockAggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await checkBalance('user-new');

      expect(result).toEqual({ balance: 0, sufficient: false });
    });
  });

  // ---------------------------------------------------------------------------
  // createTransaction
  // ---------------------------------------------------------------------------
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
          // no referenceId
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

  // ---------------------------------------------------------------------------
  // deductTokens
  // ---------------------------------------------------------------------------
  describe('deductTokens', () => {
    // Default TOKEN_MULTIPLIER is 2 (from env or fallback)
    it('calculates negative amount as -(input + output) * TOKEN_MULTIPLIER', async () => {
      mockCreate.mockResolvedValue({ id: 'tx-deduct' });

      await deductTokens('user-1', 1000, 500, 'OCR page 1', 'doc-abc');

      // -(1000 + 500) * 2 = -3000
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'consumption',
          amount: -3000,
          description: 'OCR page 1',
          referenceId: 'doc-abc',
        },
      });
    });

    it('passes type as consumption', async () => {
      mockCreate.mockResolvedValue({ id: 'tx-type' });

      await deductTokens('user-1', 100, 200, 'test');

      const createCall = mockCreate.mock.calls[0]![0];
      expect(createCall.data.type).toBe('consumption');
    });

    it('handles zero tokens', async () => {
      mockCreate.mockResolvedValue({ id: 'tx-zero' });

      await deductTokens('user-1', 0, 0, 'empty');

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'consumption',
          amount: -0,
          description: 'empty',
          referenceId: undefined,
        },
      });
    });

    it('ceils the result for fractional multiplier outcomes', async () => {
      // With default multiplier 2 and integer inputs, result is always integer.
      // But Math.ceil is still applied: -(ceil((3 + 7) * 2)) = -20
      mockCreate.mockResolvedValue({ id: 'tx-ceil' });

      await deductTokens('user-1', 3, 7, 'small job');

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'consumption',
          amount: -20,
          description: 'small job',
          referenceId: undefined,
        },
      });
    });

    it('omits referenceId when not provided', async () => {
      mockCreate.mockResolvedValue({ id: 'tx-no-ref' });

      await deductTokens('user-1', 100, 50, 'no ref');

      const createCall = mockCreate.mock.calls[0]![0];
      expect(createCall.data.referenceId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // czkToTokens
  // ---------------------------------------------------------------------------
  describe('czkToTokens', () => {
    // Default TOKEN_PRICE_PER_MILLION = 50 CZK

    it('converts halire to tokens correctly', () => {
      // 100 halire = 1 CZK → (1 / 50) * 1_000_000 = 20_000
      expect(czkToTokens(100)).toBe(20000);
    });

    it('converts larger amounts', () => {
      // 5000 halire = 50 CZK → (50 / 50) * 1_000_000 = 1_000_000
      expect(czkToTokens(5000)).toBe(1000000);
    });

    it('returns 0 for 0 halire', () => {
      expect(czkToTokens(0)).toBe(0);
    });

    it('floors the result for non-integer token amounts', () => {
      // 1 halir = 0.01 CZK → (0.01 / 50) * 1_000_000 = 200
      expect(czkToTokens(1)).toBe(200);

      // 3 halire = 0.03 CZK → (0.03 / 50) * 1_000_000 = 600
      expect(czkToTokens(3)).toBe(600);
    });

    it('handles typical payment amounts', () => {
      // 10000 halire = 100 CZK → (100 / 50) * 1_000_000 = 2_000_000
      expect(czkToTokens(10000)).toBe(2000000);

      // 25000 halire = 250 CZK → (250 / 50) * 1_000_000 = 5_000_000
      expect(czkToTokens(25000)).toBe(5000000);
    });

    it('floors partial tokens from odd halire values', () => {
      // 7 halire = 0.07 CZK → (0.07 / 50) * 1_000_000 = 1400
      expect(czkToTokens(7)).toBe(1400);

      // 33 halire = 0.33 CZK → (0.33 / 50) * 1_000_000 = 6600
      expect(czkToTokens(33)).toBe(6600);
    });
  });

  // ---------------------------------------------------------------------------
  // generateVariableSymbol
  // ---------------------------------------------------------------------------
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
      // First two attempts collide, third succeeds
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
      // All 100 attempts collide
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
