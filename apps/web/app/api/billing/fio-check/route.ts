import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { createTransaction, czkToTokens, getTokenBalance } from '@/lib/infrastructure/billing';

const lastFioCallByUser = new Map<string, number>();

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }
  const userId = session.user.id;

  // Rate limiting - FIO API allows 1 request per 30 seconds (per user)
  const now = Date.now();
  const lastCall = lastFioCallByUser.get(userId) ?? 0;
  const elapsed = now - lastCall;
  if (elapsed < 30_000) {
    const retryAfterSeconds = Math.ceil((30_000 - elapsed) / 1000);
    return NextResponse.json({ error: 'rate_limited', retryAfterSeconds }, { status: 429 });
  }

  const fioToken = process.env.FIO_API_TOKEN;
  if (!fioToken) {
    return NextResponse.json({ error: 'FIO API není nakonfigurováno' }, { status: 503 });
  }

  // Call FIO API
  lastFioCallByUser.set(userId, Date.now());
  const fioUrl = `https://www.fio.cz/ib_api/rest/last/${fioToken}/transactions.json`;

  let fioData: Record<string, unknown>;
  try {
    const res = await fetch(fioUrl);
    if (!res.ok) throw new Error(`FIO API: ${res.status}`);
    fioData = (await res.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Nepodařilo se kontaktovat FIO API' }, { status: 502 });
  }

  const statement = fioData?.accountStatement as Record<string, unknown> | undefined;
  const txList = statement?.transactionList as Record<string, unknown> | undefined;
  const transactions = (txList?.transaction ?? []) as Record<string, Record<string, unknown>>[];
  let credited = 0;

  for (const tx of transactions) {
    // VS is now the userId string
    const vs = tx.column5?.value as string | undefined; // variable symbol
    const amount = tx.column1?.value as number | undefined; // amount in CZK
    const txId = (tx.column22?.value as string | number | undefined)?.toString();

    if (!vs || !txId || !amount) continue;
    if (vs !== userId) continue; // match VS = userId
    if (amount <= 0) continue;

    const amountHalire = Math.round(amount * 100);
    const tokens = czkToTokens(amountHalire);

    try {
      await createTransaction({
        userId,
        type: 'topup_bank',
        amount: tokens,
        amountCzk: amountHalire,
        description: `Bankovní převod: ${amount.toFixed(0)} Kč`,
        referenceId: `fio-${txId}`,
      });
      credited++;
    } catch {
      // Idempotency - already processed
    }
  }

  const balance = await getTokenBalance(userId);
  return NextResponse.json({ credited, balance });
}
