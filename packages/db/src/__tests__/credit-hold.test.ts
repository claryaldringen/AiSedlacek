/**
 * Rezervace kreditu (BIL-1) nad jednoduchou in-memory náhradou Prismy – logika
 * vyúčtování, stropu a idempotence. Souběh přes skutečné zámky PostgreSQL
 * pokrývá billing.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Tr {
  id: string;
  userId: string;
  amount: number;
  referenceId: string | null;
  type: string;
  description: string;
}
interface Hold {
  id: string;
  userId: string;
  amount: number;
  referenceId: string;
  status: string;
  jobId: string | null;
  expiresAt: Date;
  closedAt: Date | null;
}

const db = vi.hoisted(() => ({
  transactions: [] as Tr[],
  holds: [] as Hold[],
  seq: 0,
}));

function matchesHold(h: Hold, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = (h as unknown as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; lt?: Date; gt?: Date; not?: unknown };
      if (c.in && !c.in.includes(value)) return false;
      if (c.lt && !((value as Date) < c.lt)) return false;
      if (c.gt && !((value as Date) > c.gt)) return false;
      if ('not' in c && value === c.not) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

vi.mock('../client', () => {
  const client = {
    tokenTransaction: {
      aggregate: vi.fn(async ({ where }: { where: { userId: string } }) => ({
        _sum: {
          amount: db.transactions
            .filter((t) => t.userId === where.userId)
            .reduce((n, t) => n + t.amount, 0),
        },
      })),
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string; referenceId: string } }) =>
          db.transactions.find(
            (t) => t.userId === where.userId && t.referenceId === where.referenceId,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Tr, 'id'> }) => {
        const row = { id: `tr-${++db.seq}`, ...data };
        db.transactions.push(row);
        return row;
      }),
    },
    creditHold: {
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: {
          amount: db.holds.filter((h) => matchesHold(h, where)).reduce((n, h) => n + h.amount, 0),
        },
      })),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          db.holds.find((h) => matchesHold(h, where)) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.holds.find((h) => h.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Partial<Hold> }) => {
        const row = {
          id: `hold-${++db.seq}`,
          status: 'active',
          closedAt: null,
          jobId: null,
          ...data,
        } as Hold;
        db.holds.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Hold> }) => {
        const h = db.holds.find((x) => x.id === where.id)!;
        Object.assign(h, data);
        return h;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Hold> }) => {
          const rows = db.holds.filter((h) => matchesHold(h, where));
          rows.forEach((h) => Object.assign(h, data));
          return { count: rows.length };
        },
      ),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(client)),
  };
  return { prisma: client };
});

import {
  InsufficientCreditError,
  isBlockedByOtherHolds,
  releaseAllJobHolds,
  checkBalance,
  consumeCredits,
  getCreditState,
  releaseExpiredHolds,
  releaseJobHolds,
  reserveCredits,
  reserveCreditsOrThrow,
  runBilledCall,
  settleCreditHold,
  settledCredits,
  type CreditCharge,
} from '../billing';
import { prisma } from '../client';

const fixed = (referenceId: string, credits: number): CreditCharge => ({
  referenceId,
  description: 'test',
  model: 'claude-sonnet-4-6',
  inputTokens: 0,
  outputTokens: 0,
  credits,
});

function topUp(userId: string, amount: number): void {
  db.transactions.push({
    id: `tr-${++db.seq}`,
    userId,
    amount,
    referenceId: null,
    type: 'topup_bank',
    description: 'top-up',
  });
}

describe('rezervace kreditu', () => {
  beforeEach(() => {
    db.transactions = [];
    db.holds = [];
    db.seq = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rezervace sníží volný kredit, ne zůstatek, a běží pod zámkem uživatele', async () => {
    topUp('u1', 1000);
    const res = await reserveCredits({
      userId: 'u1',
      amount: 400,
      referenceId: 'a',
      description: 't',
    });
    expect(res.ok).toBe(true);
    expect(await getCreditState('u1')).toEqual({ balance: 1000, reserved: 400, available: 600 });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('bez volného kreditu rezervaci odmítne a nic nezapíše', async () => {
    topUp('u1', 300);
    await reserveCredits({ userId: 'u1', amount: 200, referenceId: 'a', description: 't' });
    const res = await reserveCredits({
      userId: 'u1',
      amount: 200,
      referenceId: 'b',
      description: 't',
    });
    expect(res).toEqual({ ok: false, required: 200, available: 100, balance: 300, reserved: 200 });
    expect(db.holds).toHaveLength(1);
    await expect(
      reserveCreditsOrThrow({ userId: 'u1', amount: 200, referenceId: 'c', description: 't' }),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
  });

  it('nulový zůstatek nepustí ani nejlevnější volání', async () => {
    const res = await reserveCredits({
      userId: 'u1',
      amount: 0,
      referenceId: 'a',
      description: 't',
    });
    expect(res).toEqual({ ok: false, required: 1, available: 0, balance: 0, reserved: 0 });
  });

  it('aktivní rezervaci se stejným klíčem nezakládá podruhé', async () => {
    topUp('u1', 1000);
    const a = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 400,
      referenceId: 'k',
      description: 't',
    });
    const b = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 400,
      referenceId: 'k',
      description: 't',
    });
    expect(b.id).toBe(a.id);
    expect((await getCreditState('u1')).reserved).toBe(400);
  });

  it('vyúčtuje skutečnou spotřebu podle modelu a zbytek vrátí', async () => {
    topUp('u1', 100_000);
    const hold = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 50_000,
      referenceId: 'ocr',
      description: 't',
    });
    // Opus 5.5: 1000 × $4 + 500 × $20 = $0.014 → × 23 × 2 / 50 Kč za 1M = 12 880 kreditů
    const settle = await settleCreditHold(hold, [
      {
        referenceId: 'ocr',
        description: 'OCR',
        model: 'claude-opus-5-5',
        inputTokens: 1000,
        outputTokens: 500,
      },
    ]);
    expect(settle).toMatchObject({ charged: 12_880, uncovered: 0 });
    expect(await getCreditState('u1')).toEqual({ balance: 87_120, reserved: 0, available: 87_120 });
    expect(db.holds[0]!.status).toBe('settled');
  });

  it('položka ledgeru nese model, tokeny a svazek (BIL-11)', async () => {
    topUp('u1', 100_000);
    const hold = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 50_000,
      referenceId: 'ocr',
      description: 't',
    });
    await settleCreditHold(hold, [
      {
        referenceId: 'ocr',
        description: 'OCR',
        model: 'claude-opus-5-5',
        inputTokens: 1000,
        outputTokens: 500,
        collectionId: 'col-1',
      },
    ]);
    expect(db.transactions.at(-1)).toMatchObject({
      amount: -12_880,
      model: 'claude-opus-5-5',
      inputTokens: 1000,
      outputTokens: 500,
      collectionId: 'col-1',
    });
  });

  it('settledCredits sečte i položky zapsané dřívějším během', async () => {
    expect(
      settledCredits({
        charged: 0,
        uncovered: 0,
        transactions: [
          { referenceId: 'a', id: '1', amount: -300, existing: true },
          { referenceId: 'b', id: '2', amount: -200, existing: false },
        ],
      }),
    ).toBe(500);
  });

  it('opakované vyúčtování (restart workeru) neodečte podruhé', async () => {
    topUp('u1', 1000);
    const hold = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 500,
      referenceId: 'op',
      description: 't',
    });
    await settleCreditHold(hold, [fixed('op', 300)]);
    const again = await settleCreditHold(hold, [fixed('op', 300)]);
    expect(again.charged).toBe(0);
    expect(again.transactions[0]).toMatchObject({ existing: true, amount: -300 });
    expect((await getCreditState('u1')).balance).toBe(700);
  });

  it('spotřebu nad rezervaci odečte jen do výše volného kreditu – nikdy pod nulu', async () => {
    topUp('u1', 500);
    const a = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 200,
      referenceId: 'a',
      description: 't',
    });
    await reserveCreditsOrThrow({ userId: 'u1', amount: 250, referenceId: 'b', description: 't' });
    // volné: 500 − 450 = 50; A smí sáhnout na svých 200 + 50 volných
    const settle = await settleCreditHold(a, [fixed('a', 400)]);
    expect(settle).toMatchObject({ charged: 250, uncovered: 150 });
    expect(await getCreditState('u1')).toEqual({ balance: 250, reserved: 250, available: 0 });
  });

  it('víc položek (odmítnuté pokusy fallbacku) dělí kapacitu postupně', async () => {
    topUp('u1', 1000);
    const hold = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 1000,
      referenceId: 'b',
      description: 't',
    });
    const settle = await settleCreditHold(hold, [
      fixed('b', 700),
      fixed('b:declined:0', 200),
      fixed('b:declined:1', 300),
    ]);
    expect(settle).toMatchObject({ charged: 1000, uncovered: 200 });
    expect((await getCreditState('u1')).balance).toBe(0);
  });

  it('uvolní rezervace přerušeného jobu i rezervace po vypršení', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 300,
      referenceId: 'j',
      description: 't',
      jobId: 'job-1',
    });
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 300,
      referenceId: 'w',
      description: 't',
      ttlMs: -1,
    });
    expect(await releaseJobHolds(['job-1'])).toBe(1);
    expect(await releaseExpiredHolds()).toBe(1);
    expect(await getCreditState('u1')).toEqual({ balance: 1000, reserved: 0, available: 1000 });
  });

  it('rezervace po vypršení neblokuje další akci uživatele (líný úklid)', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 1000,
      referenceId: 'old',
      description: 't',
      ttlMs: -1,
    });
    const res = await reserveCredits({
      userId: 'u1',
      amount: 1000,
      referenceId: 'new',
      description: 't',
    });
    expect(res.ok).toBe(true);
  });

  it('checkBalance počítá s rezervacemi', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({ userId: 'u1', amount: 900, referenceId: 'a', description: 't' });
    expect(await checkBalance('u1', 200)).toMatchObject({ available: 100, sufficient: false });
    expect(await checkBalance('u1')).toMatchObject({ sufficient: true });
  });

  it('rezervace po vypršení kredit neblokuje, ani když ji úklid ještě neuvolnil', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 800,
      referenceId: 'old',
      description: 't',
    });
    db.holds[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await getCreditState('u1')).toEqual({ balance: 1000, reserved: 0, available: 1000 });
    expect(db.holds[0]!.status).toBe('active');
  });

  it('vyúčtování prošlé vlastní rezervace ji nezapočítá dvakrát – zůstatek nejde pod nulu', async () => {
    topUp('u1', 1000);
    const hold = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 800,
      referenceId: 'op',
      description: 't',
    });
    // Rezervace vypršela (dlouhé volání), mezitím jiná akce zabrala volný kredit
    db.holds[0]!.expiresAt = new Date(Date.now() - 1000);
    await reserveCreditsOrThrow({ userId: 'u1', amount: 900, referenceId: 'b', description: 't' });
    // Volných je 1000 − 900 = 100; prošlá vlastní rezervace se nesmí přičíst
    const settle = await settleCreditHold(hold, [fixed('op', 700)]);
    expect(settle).toMatchObject({ charged: 100, uncovered: 600 });
    expect(await getCreditState('u1')).toEqual({ balance: 900, reserved: 900, available: 0 });
  });

  it('odmítnutá rezervace hlásí zůstatek a cizí rezervace (čekání místo chyby)', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({ userId: 'u1', amount: 700, referenceId: 'a', description: 't' });
    const res = await reserveCredits({
      userId: 'u1',
      amount: 600,
      referenceId: 'b',
      description: 't',
    });
    expect(res).toEqual({ ok: false, required: 600, available: 300, balance: 1000, reserved: 700 });
    expect(!res.ok && isBlockedByOtherHolds(res)).toBe(true);
    const err = await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 600,
      referenceId: 'c',
      description: 't',
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ required: 600, available: 300, balance: 1000, reserved: 700 });
  });

  it('skutečný nedostatek (bez cizích rezervací nebo nad zůstatek) není čekání', () => {
    expect(isBlockedByOtherHolds({ required: 600, balance: 500, reserved: 0 })).toBe(false);
    expect(isBlockedByOtherHolds({ required: 600, balance: 500, reserved: 400 })).toBe(false);
    expect(isBlockedByOtherHolds({ required: 600, balance: 900, reserved: 400 })).toBe(true);
  });

  it('při startu workeru uvolní rezervace všech jobů, rezervace webu nechá', async () => {
    topUp('u1', 1000);
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 100,
      referenceId: 'j1',
      description: 't',
      jobId: 'job-cancelled',
    });
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 100,
      referenceId: 'j2',
      description: 't',
      jobId: 'job-error',
    });
    await reserveCreditsOrThrow({
      userId: 'u1',
      amount: 100,
      referenceId: 'chat',
      description: 't',
    });
    expect(await releaseAllJobHolds()).toBe(2);
    expect((await getCreditState('u1')).reserved).toBe(100);
  });

  it('consumeCredits provede efekt pod stejným zámkem a předá mu odečet', async () => {
    topUp('u1', 100);
    const effect = vi.fn(async () => 'kopie');
    const res = await consumeCredits('u1', fixed('dedup', 60), effect);
    expect(res).toMatchObject({ ok: true, value: 'kopie' });
    expect(effect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ charged: 60 }),
    );
    // Bez kreditu se efekt neprovede
    const refused = await consumeCredits('u1', fixed('dedup-2', 60), effect);
    expect(refused.ok).toBe(false);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('consumeCredits odečte jen při dostatku volného kreditu a je idempotentní', async () => {
    topUp('u1', 100);
    expect(await consumeCredits('u1', fixed('dedup', 150))).toEqual({
      ok: false,
      required: 150,
      available: 100,
      balance: 100,
      reserved: 0,
    });
    expect((await consumeCredits('u1', fixed('dedup', 60))).ok).toBe(true);
    expect((await consumeCredits('u1', fixed('dedup', 60))).ok).toBe(true);
    expect((await getCreditState('u1')).balance).toBe(40);
  });

  describe('runBilledCall', () => {
    const reserve = { userId: 'u1', amount: 500, referenceId: 'call', description: 't' };

    it('úspěšné volání vyúčtuje spotřebu z výsledku', async () => {
      topUp('u1', 1000);
      const { result, billing } = await runBilledCall(
        reserve,
        async () => 'ok',
        () => [fixed('call', 120)],
      );
      expect(result).toBe('ok');
      expect(billing).toMatchObject({ ok: true, settle: { charged: 120 } });
      expect(await getCreditState('u1')).toEqual({ balance: 880, reserved: 0, available: 880 });
    });

    it('bez kreditu volání vůbec nespustí', async () => {
      const call = vi.fn();
      await expect(runBilledCall(reserve, call, () => [])).rejects.toBeInstanceOf(
        InsufficientCreditError,
      );
      expect(call).not.toHaveBeenCalled();
    });

    it('chyba bez spotřeby rezervaci uvolní a propustí dál', async () => {
      topUp('u1', 1000);
      await expect(
        runBilledCall(
          reserve,
          async () => Promise.reject(new Error('API down')),
          () => [],
        ),
      ).rejects.toThrow('API down');
      expect(db.holds[0]!.status).toBe('released');
      expect((await getCreditState('u1')).balance).toBe(1000);
    });

    it('chyba se spotřebou (odmítnutí modelem) se vyúčtuje', async () => {
      topUp('u1', 1000);
      await expect(
        runBilledCall(
          reserve,
          async () => Promise.reject(new Error('refused')),
          () => [],
          () => [fixed('call:refused', 80)],
        ),
      ).rejects.toThrow('refused');
      expect(db.holds[0]!.status).toBe('settled');
      expect((await getCreditState('u1')).balance).toBe(920);
    });

    it('selhání vyúčtování výsledek nezahodí a rezervaci uvolní', async () => {
      topUp('u1', 1000);
      const create = prisma.tokenTransaction.create as unknown as ReturnType<typeof vi.fn>;
      create.mockRejectedValueOnce(new Error('db down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result, billing } = await runBilledCall(
        reserve,
        async () => 'paid output',
        () => [fixed('call', 120)],
      );
      expect(result).toBe('paid output');
      expect(billing.ok).toBe(false);
      expect(db.holds[0]!.status).toBe('released');
    });
  });
});
