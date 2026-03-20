import { prisma } from './db';

const TOKEN_MULTIPLIER = parseInt(process.env.TOKEN_MULTIPLIER ?? '2');
const TOKEN_PRICE_PER_MILLION = parseFloat(process.env.TOKEN_PRICE_PER_MILLION ?? '50');

export async function getTokenBalance(userId: string): Promise<number> {
  const result = await prisma.tokenTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function checkBalance(userId: string): Promise<{ balance: number; sufficient: boolean }> {
  const balance = await getTokenBalance(userId);
  return { balance, sufficient: balance > 0 };
}

export async function createTransaction(data: {
  userId: string;
  type: 'topup_stripe' | 'topup_bank' | 'consumption' | 'refund';
  amount: number;
  description: string;
  referenceId?: string;
  amountCzk?: number;
}) {
  try {
    return await prisma.tokenTransaction.create({ data });
  } catch (e: unknown) {
    // Idempotency: if referenceId already exists, return existing
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002' && data.referenceId) {
      const existing = await prisma.tokenTransaction.findFirst({
        where: { userId: data.userId, referenceId: data.referenceId },
      });
      if (existing) return existing;
    }
    throw e;
  }
}

export async function deductTokens(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  description: string,
  referenceId?: string,
) {
  const amount = -Math.ceil((inputTokens + outputTokens) * TOKEN_MULTIPLIER);
  return createTransaction({
    userId,
    type: 'consumption',
    amount,
    description,
    referenceId,
  });
}

/**
 * Atomically check balance and deduct tokens in a single serializable transaction.
 * Prevents race conditions where concurrent requests both see positive balance
 * and proceed to overspend.
 */
export async function deductTokensIfSufficient(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  description: string,
  referenceId?: string,
): Promise<{ success: boolean; balance: number; transaction?: { id: string; amount: number } }> {
  const amount = -Math.ceil((inputTokens + outputTokens) * TOKEN_MULTIPLIER);

  return prisma.$transaction(
    async (tx) => {
      const result = await tx.tokenTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      });
      const balance = result._sum.amount ?? 0;

      if (balance <= 0) {
        return { success: false, balance };
      }

      // Handle idempotency: if referenceId already exists, return existing
      if (referenceId) {
        const existing = await tx.tokenTransaction.findFirst({
          where: { userId, referenceId },
        });
        if (existing) {
          return {
            success: true,
            balance: balance + existing.amount,
            transaction: { id: existing.id, amount: existing.amount },
          };
        }
      }

      const transaction = await tx.tokenTransaction.create({
        data: {
          userId,
          type: 'consumption',
          amount,
          description,
          referenceId,
        },
      });

      return {
        success: true,
        balance: balance + amount,
        transaction: { id: transaction.id, amount: transaction.amount },
      };
    },
    {
      isolationLevel: 'Serializable',
    },
  );
}

export function czkToTokens(amountHalire: number): number {
  // amountHalire is in halire (1 CZK = 100 halire)
  const amountCzk = amountHalire / 100;
  return Math.floor((amountCzk / TOKEN_PRICE_PER_MILLION) * 1_000_000);
}

export async function generateVariableSymbol(): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const vs = Math.floor(Math.random() * 900000) + 100000;
    const existing = await prisma.user.findFirst({ where: { variableSymbol: vs } });
    if (!existing) return vs;
  }
  throw new Error('Nepodařilo se vygenerovat unikátní variabilní symbol');
}
