/**
 * Integrační test rezervací kreditu proti skutečné PostgreSQL (zámky, souběh).
 *
 * Spouští se jen s proměnnou `BILLING_IT_DATABASE_URL` (prázdná databáze
 * s aplikovanými migracemi), jinak se přeskočí – CI databázi nemá:
 *
 *   BILLING_IT_DATABASE_URL=postgresql://…/aisedlacek_test npx vitest run billing.integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const url = process.env.BILLING_IT_DATABASE_URL;

describe.skipIf(!url)('billing – rezervace proti PostgreSQL', () => {
  let prisma: PrismaClient;
  let billing: typeof import('../billing');
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import('../client'));
    billing = await import('../billing');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function userWithBalance(amount: number): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `billing-it-${Date.now()}-${Math.random()}@example.test` },
    });
    userIds.push(user.id);
    if (amount > 0) {
      await prisma.tokenTransaction.create({
        data: { userId: user.id, type: 'topup_bank', amount, description: 'test' },
      });
    }
    return user.id;
  }

  const fixed = (referenceId: string, credits: number): import('../billing').CreditCharge => ({
    referenceId,
    description: 'test',
    model: 'claude-sonnet-4-6',
    inputTokens: 0,
    outputTokens: 0,
    credits,
  });

  it('souběžné rezervace těsně u nuly nepřečerpají volný kredit', async () => {
    const userId = await userWithBalance(1000);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        billing.reserveCredits({ userId, amount: 100, referenceId: `op-${i}`, description: 't' }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const state = await billing.getCreditState(userId);
    expect(state).toEqual({ balance: 1000, reserved: 1000, available: 0 });
  });

  it('vyúčtování odečte skutečnou spotřebu a zbytek rezervace vrátí', async () => {
    const userId = await userWithBalance(1000);
    const hold = await billing.reserveCreditsOrThrow({
      userId,
      amount: 500,
      referenceId: 'op',
      description: 't',
    });
    const settle = await billing.settleCreditHold(hold, [fixed('op', 300)]);
    expect(settle).toMatchObject({ charged: 300, uncovered: 0 });
    expect(await billing.getCreditState(userId)).toEqual({
      balance: 700,
      reserved: 0,
      available: 700,
    });
    // Opakované vyúčtování (restart workeru) neodečte podruhé
    const again = await billing.settleCreditHold(hold, [fixed('op', 300)]);
    expect(again.charged).toBe(0);
    expect(await billing.getTokenBalance(userId)).toBe(700);
  });

  it('spotřeba nad rezervací nikdy nepošle zůstatek pod nulu', async () => {
    const userId = await userWithBalance(100);
    const hold = await billing.reserveCreditsOrThrow({
      userId,
      amount: 100,
      referenceId: 'op',
      description: 't',
    });
    const settle = await billing.settleCreditHold(hold, [fixed('op', 250)]);
    expect(settle).toMatchObject({ charged: 100, uncovered: 150 });
    expect(await billing.getTokenBalance(userId)).toBe(0);
  });

  it('cizí aktivní rezervace se při vyúčtování nepřečerpá', async () => {
    const userId = await userWithBalance(1000);
    const a = await billing.reserveCreditsOrThrow({
      userId,
      amount: 400,
      referenceId: 'a',
      description: 't',
    });
    await billing.reserveCreditsOrThrow({
      userId,
      amount: 600,
      referenceId: 'b',
      description: 't',
    });
    // Spotřeba A přesáhne její rezervaci – smí sáhnout jen na vlastní rezervaci
    const settle = await billing.settleCreditHold(a, [fixed('a', 900)]);
    expect(settle).toMatchObject({ charged: 400, uncovered: 500 });
    expect(await billing.getCreditState(userId)).toEqual({
      balance: 600,
      reserved: 600,
      available: 0,
    });
  });

  it('osiřelé rezervace se uvolní po vypršení i úklidem jobu', async () => {
    const userId = await userWithBalance(1000);
    await billing.reserveCreditsOrThrow({
      userId,
      amount: 1000,
      referenceId: 'expired',
      description: 't',
      ttlMs: -1,
    });
    // Líný úklid při další rezervaci uvolní prošlou rezervaci
    const next = await billing.reserveCreditsOrThrow({
      userId,
      amount: 1000,
      referenceId: 'job-op',
      description: 't',
      jobId: 'job-crashed',
    });
    expect(next.amount).toBe(1000);
    expect(await billing.releaseJobHolds(['job-crashed'])).toBe(1);
    expect((await billing.getCreditState(userId)).available).toBe(1000);
  });

  it('rezervaci uvolněnou úklidem lze vyúčtovat jen z volného kreditu', async () => {
    const userId = await userWithBalance(1000);
    const hold = await billing.reserveCreditsOrThrow({
      userId,
      amount: 800,
      referenceId: 'op',
      description: 't',
      jobId: 'job-x',
    });
    await billing.releaseJobHolds(['job-x']);
    await billing.reserveCreditsOrThrow({
      userId,
      amount: 900,
      referenceId: 'other',
      description: 't',
    });
    const settle = await billing.settleCreditHold(hold, [fixed('op', 300)]);
    expect(settle).toMatchObject({ charged: 100, uncovered: 200 });
    expect(await billing.getTokenBalance(userId)).toBe(900);
  });

  it('consumeCredits odečte jen při dostatku volného kreditu', async () => {
    const userId = await userWithBalance(100);
    const refused = await billing.consumeCredits(userId, fixed('dedup', 150));
    expect(refused).toEqual({
      ok: false,
      required: 150,
      available: 100,
      balance: 100,
      reserved: 0,
    });
    const ok = await billing.consumeCredits(userId, fixed('dedup', 60));
    expect(ok.ok).toBe(true);
    expect(await billing.getTokenBalance(userId)).toBe(40);
  });

  it('když efekt consumeCredits selže, odečet se vrátí (jedna transakce)', async () => {
    const userId = await userWithBalance(100);
    await expect(
      billing.consumeCredits(userId, fixed('dedup-fail', 60), async (tx) => {
        await tx.tokenTransaction.count({ where: { userId } });
        throw new Error('kopie selhala');
      }),
    ).rejects.toThrow('kopie selhala');
    expect(await billing.getTokenBalance(userId)).toBe(100);
    // Opakování po opravě projde a zaplatí se jen jednou
    const ok = await billing.consumeCredits(userId, fixed('dedup-fail', 60), async () => 'ok');
    expect(ok).toMatchObject({ ok: true, value: 'ok' });
    expect(await billing.getTokenBalance(userId)).toBe(40);
  });

  it('prošlá rezervace neblokuje a její vyúčtování nejde pod nulu', async () => {
    const userId = await userWithBalance(1000);
    const hold = await billing.reserveCreditsOrThrow({
      userId,
      amount: 800,
      referenceId: 'op',
      description: 't',
    });
    await prisma.creditHold.update({
      where: { id: hold.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await billing.getCreditState(userId)).available).toBe(1000);
    await billing.reserveCreditsOrThrow({
      userId,
      amount: 900,
      referenceId: 'b',
      description: 't',
    });
    const settle = await billing.settleCreditHold(hold, [fixed('op', 700)]);
    expect(settle).toMatchObject({ charged: 100, uncovered: 600 });
    expect(await billing.getTokenBalance(userId)).toBe(900);
  });

  it('kapacita vyúčtování jedním dotazem: zůstatek − živé cizí rezervace (prošlé ne)', async () => {
    const userId = await userWithBalance(1000);
    const hold = await billing.reserveCreditsOrThrow({
      userId,
      amount: 500,
      referenceId: 'own',
      description: 't',
    });
    await billing.reserveCreditsOrThrow({
      userId,
      amount: 300,
      referenceId: 'live',
      description: 't',
    });
    const expired = await billing.reserveCreditsOrThrow({
      userId,
      amount: 150,
      referenceId: 'expired',
      description: 't',
    });
    // Prošlá jen o chvíli – při chybném převodu časové zóny (spojení není v UTC)
    // by se počítala jako živá
    await prisma.creditHold.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Strop = 1000 − 300 (vlastní rezervace se nepočítá ani dvakrát, ani vůbec)
    const settle = await billing.settleCreditHold(hold, [fixed('own', 900)]);
    expect(settle).toMatchObject({ charged: 700, uncovered: 200 });
    expect(await billing.getTokenBalance(userId)).toBe(300);
    const own = await prisma.creditHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(own.status).toBe('settled');
  });
});
