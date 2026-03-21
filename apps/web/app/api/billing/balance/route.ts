import { auth } from '@/lib/auth';
import { prisma } from '@/lib/infrastructure/db';
import { getTokenBalance } from '@/lib/infrastructure/billing';

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id as string | undefined;

  if (!userId) {
    return Response.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const balance = await getTokenBalance(userId);

  const transactions = await prisma.tokenTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return Response.json({ balance, transactions });
}
