import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { createTransaction, czkToTokens, getTokenBalance, generateVariableSymbol } from '@/lib/infrastructure/billing';

let lastFioCall = 0;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }
  const userId = session.user.id;

  // Rate limiting - FIO API allows 1 request per 30 seconds
  const now = Date.now();
  const elapsed = now - lastFioCall;
  if (elapsed < 30_000) {
    const retryAfterSeconds = Math.ceil((30_000 - elapsed) / 1000);
    return NextResponse.json({ error: 'rate_limited', retryAfterSeconds }, { status: 429 });
  }

  // Ensure user has a variable symbol
  let user = await prisma.user.findUnique({ where: { id: userId }, select: { variableSymbol: true } });
  if (!user?.variableSymbol) {
    const vs = await generateVariableSymbol();
    await prisma.user.update({ where: { id: userId }, data: { variableSymbol: vs } });
    user = { variableSymbol: vs };
  }

  const fioToken = process.env.FIO_API_TOKEN;
  if (!fioToken) {
    return NextResponse.json({ error: 'FIO API není nakonfigurováno' }, { status: 503 });
  }

  // Call FIO API
  lastFioCall = Date.now();
  const fioUrl = `https://www.fio.cz/ib_api/rest/last/${fioToken}/transactions.json`;

  let fioData: any;
  try {
    const res = await fetch(fioUrl);
    if (!res.ok) throw new Error(`FIO API: ${res.status}`);
    fioData = await res.json();
  } catch (e) {
    return NextResponse.json({ error: 'Nepodařilo se kontaktovat FIO API' }, { status: 502 });
  }

  const transactions = fioData?.accountStatement?.transactionList?.transaction ?? [];
  let credited = 0;

  for (const tx of transactions) {
    // Extract fields from FIO transaction
    const vs = tx.column5?.value; // variable symbol
    const amount = tx.column1?.value; // amount in CZK (float)
    const txId = tx.column22?.value?.toString(); // FIO transaction ID

    if (!vs || !txId || !amount) continue;
    if (parseInt(vs) !== user.variableSymbol) continue;
    if (amount <= 0) continue; // only incoming payments

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
