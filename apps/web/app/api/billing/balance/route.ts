import { auth } from '@/lib/auth';
import { prisma } from '@/lib/infrastructure/db';
import { getTokenBalance, generateVariableSymbol } from '@/lib/infrastructure/billing';

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return Response.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const balance = await getTokenBalance(userId);

  // Ensure user has a variable symbol
  let user = await prisma.user.findUnique({
    where: { id: userId },
    select: { variableSymbol: true },
  });

  let variableSymbol = user?.variableSymbol ?? null;

  if (variableSymbol === null) {
    variableSymbol = await generateVariableSymbol();
    await prisma.user.update({
      where: { id: userId },
      data: { variableSymbol },
    });
  }

  const transactions = await prisma.tokenTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return Response.json({ balance, variableSymbol, transactions });
}
