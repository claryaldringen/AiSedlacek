import { creditsForUsage, czkToCredits } from '@ai-sedlacek/shared';
import { prisma } from './client';

export async function getTokenBalance(userId: string): Promise<number> {
  const result = await prisma.tokenTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function checkBalance(
  userId: string,
): Promise<{ balance: number; sufficient: boolean }> {
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
}): Promise<{
  id: string;
  userId: string;
  type: string;
  amount: number;
  description: string;
  referenceId: string | null;
  amountCzk: number | null;
  createdAt: Date;
}> {
  try {
    return await prisma.tokenTransaction.create({ data });
  } catch (e: unknown) {
    // Idempotency: if referenceId already exists, return existing
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'P2002' &&
      data.referenceId
    ) {
      const existing = await prisma.tokenTransaction.findFirst({
        where: { userId: data.userId, referenceId: data.referenceId },
      });
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Odečte kredity za volání LLM. Částka se počítá ze skutečného nákladu API
 * daného modelu (vstup a výstup zvlášť) × marže – viz `@ai-sedlacek/shared`
 * pricing. Dřív se účtovalo (vstup + výstup) × 2 bez ohledu na model, takže
 * OCR na Opusu se prodávalo pod náklady.
 */
export async function deductTokens(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  description: string,
  referenceId: string | undefined,
  model: string,
): ReturnType<typeof createTransaction> {
  const amount = -creditsForUsage(model, inputTokens, outputTokens);
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
  referenceId: string | undefined,
  /** Model, který skutečně odpověděl (`response.model`) – určuje sazbu. */
  model: string,
): Promise<{ success: boolean; balance: number; transaction?: { id: string; amount: number } }> {
  const amount = -creditsForUsage(model, inputTokens, outputTokens);

  const MAX_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const result = await tx.tokenTransaction.aggregate({
            where: { userId },
            _sum: { amount: true },
          });
          const balance = result._sum.amount ?? 0;

          if (balance <= 0) {
            return { success: false, balance };
          }

          // Idempotency: if referenceId already exists, return existing. The
          // aggregated balance already includes that transaction's amount, so it
          // must NOT be added again (doing so previously reported a doubled deduction).
          if (referenceId) {
            const existing = await tx.tokenTransaction.findFirst({
              where: { userId, referenceId },
            });
            if (existing) {
              return {
                success: true,
                balance,
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
    } catch (e) {
      // Serializable transactions can fail with a write conflict / serialization
      // failure under concurrency (Prisma P2034) — retry a few times before giving up.
      lastError = e;
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: unknown }).code
          : undefined;
      if (code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
      throw e;
    }
  }
  throw lastError;
}

export function czkToTokens(amountHalire: number): number {
  // amountHalire is in halire (1 CZK = 100 halire)
  return czkToCredits(amountHalire);
}

export async function generateVariableSymbol(): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const vs = Math.floor(Math.random() * 900000) + 100000;
    const existing = await prisma.user.findFirst({ where: { variableSymbol: vs } });
    if (!existing) return vs;
  }
  throw new Error('Nepodařilo se vygenerovat unikátní variabilní symbol');
}
