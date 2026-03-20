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
