import type { Prisma } from '@prisma/client';
import { creditsForUsage, czkToCredits } from '@ai-sedlacek/shared';
import { prisma } from './client';

/**
 * Kreditový billing.
 *
 * Ledger `TokenTransaction` je append-only, zůstatek = součet `amount`
 * a idempotenci drží `@@unique([userId, referenceId])`. Zůstatek nikdy nesmí
 * klesnout pod nulu (rozhodnutí 2026-10-15, BIL-1): každé placené volání LLM
 * si nejdřív atomicky zarezervuje odhad maximální ceny (`CreditHold`), po
 * volání se do ledgeru zapíše skutečná spotřeba a rezervace se uzavře – zbytek
 * se tím vrací. Volný kredit = zůstatek − aktivní rezervace.
 *
 * Všechny operace, které volný kredit snižují (rezervace, vyúčtování, odečet
 * bez rezervace), běží v transakci pod per-user advisory zámkem, takže dvě
 * souběžné akce těsně u nuly se serializují a druhá rezervaci nedostane.
 */

/** Rezervace bez vyúčtování se po této době považuje za osiřelou (pád webu). */
export const DEFAULT_HOLD_TTL_MS = 30 * 60 * 1000;

/**
 * Rezervace jobu workeru – OCR dávka na Opusu může generovat desítky minut.
 * Osiřelé rezervace jobů uvolňuje hlavně úklid přerušených jobů; TTL je pojistka.
 */
export const JOB_HOLD_TTL_MS = 2 * 60 * 60 * 1000;

/** Třída advisory zámku (první klíč) – odliší zámky billingu od jiných v téže DB. */
const CREDIT_LOCK_CLASS = 727_001;

type Tx = Prisma.TransactionClient;

/** Transakční klient, ve kterém běží odečet (`consumeCredits` s efektem). */
export type CreditTx = Tx;

export async function getTokenBalance(userId: string): Promise<number> {
  const result = await prisma.tokenTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export interface CreditState {
  /** Zůstatek v ledgeru (součet transakcí). */
  balance: number;
  /** Součet aktivních (nevypršených) rezervací. */
  reserved: number;
  /** Volný kredit = zůstatek − rezervace. */
  available: number;
}

/**
 * Rezervace, která blokuje kredit: aktivní a nevypršená. Prošlá rezervace
 * (pád webu, osiřelý job) kredit neblokuje, ani když ji úklid ještě neuvolnil.
 */
function liveHoldWhere(now: Date): { status: 'active'; expiresAt: { gt: Date } } {
  return { status: 'active', expiresAt: { gt: now } };
}

async function readCreditState(
  client: Tx | typeof prisma,
  userId: string,
  now = new Date(),
): Promise<CreditState> {
  const [ledger, holds] = [
    await client.tokenTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    await client.creditHold.aggregate({
      where: { userId, ...liveHoldWhere(now) },
      _sum: { amount: true },
    }),
  ];
  const balance = ledger._sum.amount ?? 0;
  const reserved = holds._sum.amount ?? 0;
  return { balance, reserved, available: balance - reserved };
}

/** Zůstatek, rezervace a volný kredit (bez zámku – jen pro zobrazení a předběžné kontroly). */
export async function getCreditState(userId: string): Promise<CreditState> {
  return readCreditState(prisma, userId);
}

/**
 * Předběžná kontrola před založením jobu nebo voláním: stačí volný kredit na
 * `required` kreditů? Závazná je až rezervace (`reserveCredits`) těsně před
 * voláním LLM – tahle kontrola jen dřív odmítne akci, která by stejně neprošla.
 */
export async function checkBalance(
  userId: string,
  required = 1,
): Promise<CreditState & { required: number; sufficient: boolean }> {
  const state = await getCreditState(userId);
  return { ...state, required, sufficient: state.available >= Math.max(1, required) };
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

// ── Rezervace kreditu (BIL-1) ────────────────────────────────

/** Volný kredit nestačí na rezervaci – akce se nespustí. */
export class InsufficientCreditError extends Error {
  readonly code = 'insufficient_credit';
  constructor(
    readonly required: number,
    readonly available: number,
    /** Zůstatek v ledgeru (bez odečtu rezervací). */
    readonly balance: number = available,
    /** Kredit blokovaný jinými aktivními rezervacemi uživatele. */
    readonly reserved: number = 0,
  ) {
    super(`Nedostatečný kredit: akce potřebuje ${required} kreditů, volných je ${available}`);
    this.name = 'InsufficientCreditError';
  }
}

/**
 * Kredit chybí jen kvůli jiným běžícím akcím uživatele: bez jejich rezervací by
 * zůstatek stačil. Akce v takovém případě skončí kódem `credit_busy` (route 409,
 * job chybou) – uživatel ji spustí znovu, až se rezervace uvolní (po vyúčtování
 * se nevyužitá část vrací); dobíjet kredit nemusí.
 */
export function isBlockedByOtherHolds(shortage: {
  required: number;
  balance?: number;
  reserved?: number;
}): boolean {
  return (shortage.reserved ?? 0) > 0 && (shortage.balance ?? 0) >= shortage.required;
}

export interface CreditHoldHandle {
  id: string;
  userId: string;
  amount: number;
  referenceId: string;
}

export interface ReserveParams {
  userId: string;
  /** Rezervované kredity – odhad maximální ceny volání (`reservationCredits`). */
  amount: number;
  /**
   * Klíč operace – zároveň výchozí `referenceId` odečtu při vyúčtování.
   * Aktivní rezervace se stejným klíčem se nezakládá podruhé (idempotence).
   */
  referenceId: string;
  description: string;
  /** Job workeru – podle něj se rezervace uvolní při úklidu přerušeného jobu. */
  jobId?: string | null;
  ttlMs?: number;
}

export interface CreditShortage {
  required: number;
  available: number;
  balance: number;
  reserved: number;
}

export type ReserveResult = { ok: true; hold: CreditHoldHandle } | ({ ok: false } & CreditShortage);

/** Interaktivní transakce pod per-user zámkem (serializuje operace jednoho uživatele). */
async function withUserLock<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CREDIT_LOCK_CLASS}::int, hashtext(${userId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

async function releaseExpiredHoldsOfUser(tx: Tx, userId: string, now: Date): Promise<number> {
  const { count } = await tx.creditHold.updateMany({
    where: { userId, status: 'active', expiresAt: { lt: now } },
    data: { status: 'released', closedAt: now },
  });
  return count;
}

/**
 * Atomicky zarezervuje kredit před placeným voláním. Při nedostatku volného
 * kreditu vrátí `ok: false` a nic nezapíše – volající akci nespustí.
 */
export async function reserveCredits(params: ReserveParams): Promise<ReserveResult> {
  const { userId, referenceId, description } = params;
  const amount = Math.max(1, Math.ceil(params.amount));
  const ttlMs = params.ttlMs ?? (params.jobId ? JOB_HOLD_TTL_MS : DEFAULT_HOLD_TTL_MS);

  const result = await withUserLock(userId, async (tx): Promise<ReserveResult> => {
    const now = new Date();
    // Líný úklid: rezervace po vypršení (pád webu uprostřed chatu) uživatele neblokují.
    await releaseExpiredHoldsOfUser(tx, userId, now);

    const existing = await tx.creditHold.findFirst({
      where: { userId, referenceId, status: 'active' },
      select: { id: true, amount: true },
    });
    if (existing) {
      return { ok: true, hold: { id: existing.id, userId, amount: existing.amount, referenceId } };
    }

    const state = await readCreditState(tx, userId, now);
    if (state.available < amount) return { ok: false, required: amount, ...state };

    const hold = await tx.creditHold.create({
      data: {
        userId,
        amount,
        referenceId,
        description,
        jobId: params.jobId ?? null,
        expiresAt: new Date(now.getTime() + ttlMs),
      },
      select: { id: true },
    });
    return { ok: true, hold: { id: hold.id, userId, amount, referenceId } };
  });

  if (result.ok) {
    console.log(
      `[Billing] Reserved ${result.hold.amount} credits (hold ${result.hold.id}, ref ${referenceId})`,
    );
  } else {
    console.log(
      `[Billing] Reservation refused: required ${result.required}, available ${result.available} (ref ${referenceId})`,
    );
  }
  return result;
}

/** Jako `reserveCredits`, ale při nedostatku vyhodí `InsufficientCreditError`. */
export async function reserveCreditsOrThrow(params: ReserveParams): Promise<CreditHoldHandle> {
  const result = await reserveCredits(params);
  if (!result.ok) {
    throw new InsufficientCreditError(
      result.required,
      result.available,
      result.balance,
      result.reserved,
    );
  }
  return result.hold;
}

/** Jedna položka vyúčtování – skutečná spotřeba volání (nebo pevná částka). */
export interface CreditCharge {
  referenceId: string;
  description: string;
  /** Model, který skutečně odpověděl (`response.model`) – určuje sazbu. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Pevná částka místo výpočtu z tokenů (např. deduplikovaná kopie OCR). */
  credits?: number;
  /** Svazek, ke kterému spotřeba patří – z ledgeru se počítá cena svazku (BIL-11). */
  collectionId?: string | null;
}

export interface SettleResult {
  /** Skutečně odečtené kredity (bez položek, které už v ledgeru byly). */
  charged: number;
  /** Část spotřeby, kterou nešlo odečíst, aby zůstatek neklesl pod nulu. */
  uncovered: number;
  transactions: { referenceId: string; id: string | null; amount: number; existing: boolean }[];
}

function chargeCredits(charge: CreditCharge): number {
  if (charge.credits !== undefined) return Math.max(0, Math.ceil(charge.credits));
  return creditsForUsage(charge.model, charge.inputTokens, charge.outputTokens);
}

/**
 * Zapíše položky do ledgeru pod zámkem, každou nejvýš do výše `capacity`
 * (volný kredit včetně případné vlastní rezervace), aby zůstatek nikdy neklesl
 * pod nulu. Položka, jejíž `referenceId` už v ledgeru je, se nezapisuje znovu.
 */
async function writeCharges(
  tx: Tx,
  userId: string,
  charges: CreditCharge[],
  capacity: number,
): Promise<SettleResult> {
  const result: SettleResult = { charged: 0, uncovered: 0, transactions: [] };
  let remaining = Math.max(0, capacity);
  for (const charge of charges) {
    const credits = chargeCredits(charge);
    if (credits <= 0) continue;
    const existing = await tx.tokenTransaction.findFirst({
      where: { userId, referenceId: charge.referenceId },
      select: { id: true, amount: true },
    });
    if (existing) {
      result.transactions.push({
        referenceId: charge.referenceId,
        id: existing.id,
        amount: existing.amount,
        existing: true,
      });
      continue;
    }
    const amount = Math.min(credits, remaining);
    remaining -= amount;
    result.uncovered += credits - amount;
    if (amount <= 0) {
      result.transactions.push({
        referenceId: charge.referenceId,
        id: null,
        amount: 0,
        existing: false,
      });
      continue;
    }
    const tr = await tx.tokenTransaction.create({
      data: {
        userId,
        type: 'consumption',
        amount: -amount,
        description: charge.description,
        referenceId: charge.referenceId,
        // Podklad částky a příslušnost ke svazku (BIL-11)
        model: charge.model,
        inputTokens: charge.inputTokens,
        outputTokens: charge.outputTokens,
        collectionId: charge.collectionId ?? null,
      },
      select: { id: true },
    });
    result.charged += amount;
    result.transactions.push({
      referenceId: charge.referenceId,
      id: tr.id,
      amount: -amount,
      existing: false,
    });
  }
  return result;
}

function logUncovered(userId: string, ref: string, result: SettleResult): void {
  if (result.uncovered > 0) {
    // Odhad rezervace nepokryl skutečnou spotřebu a volný kredit nestačil –
    // rozdíl nese provozovatel (zůstatek nesmí do minusu). Má se stávat výjimečně.
    console.warn(
      `[Billing] Spotřeba nad rezervací nepokryta: ${result.uncovered} kreditů (uživatel ${userId}, ${ref})`,
    );
  }
}

/**
 * Vyúčtuje rezervaci: zapíše skutečnou spotřebu (`charges`) a rezervaci uzavře –
 * nespotřebovaná část se tím vrací do volného kreditu. Odečet se nikdy nedostane
 * pod nulu: když spotřeba přesáhne rezervaci a volný kredit, odečte se jen
 * dostupná část a rozdíl se zaloguje. Idempotentní – opakované vyúčtování
 * (restart workeru) nezapíše položky se stejným `referenceId` podruhé.
 * Rezervaci, kterou mezitím uvolnil úklid (TTL, pád jobu), lze vyúčtovat také –
 * jen z volného kreditu.
 */
/**
 * Kolik lze při vyúčtování rezervace nejvýš odečíst: zůstatek minus živé
 * (aktivní, nevypršené) rezervace uživatele KROMĚ té vyúčtovávané – jedním
 * dotazem. Dřív se stav vlastní rezervace četl zvlášť a k volnému kreditu se
 * přičítal; úklid rezervací neběží pod zámkem uživatele, takže uvolnění mezi
 * oběma čteními započetlo vlastní rezervaci dvakrát a zůstatek mohl jít do minusu.
 * (`expiresAt` je `timestamp` v UTC – okamžik se proto předává jako ISO řetězec
 * a převádí explicitně, nezávisle na časové zóně spojení.)
 */
async function settleCapacity(
  tx: Tx,
  hold: Pick<CreditHoldHandle, 'id' | 'userId'>,
  now: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<{ capacity: bigint | number | null }[]>`
    SELECT
      COALESCE((SELECT SUM("amount") FROM "TokenTransaction" WHERE "userId" = ${hold.userId}), 0)
      - COALESCE((
          SELECT SUM("amount") FROM "CreditHold"
          WHERE "userId" = ${hold.userId}
            AND "status" = 'active'
            AND "expiresAt" > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
            AND "id" <> ${hold.id}
        ), 0) AS "capacity"`;
  return Number(rows[0]?.capacity ?? 0);
}

export async function settleCreditHold(
  hold: CreditHoldHandle,
  charges: CreditCharge[],
): Promise<SettleResult> {
  const result = await withUserLock(hold.userId, async (tx) => {
    const now = new Date();
    const capacity = await settleCapacity(tx, hold, now);
    const settled = await writeCharges(tx, hold.userId, charges, capacity);
    // Jen aktivní rezervace přejde na settled; uvolněnou (úklid jobu, TTL) nechat
    await tx.creditHold.updateMany({
      where: { id: hold.id, status: 'active' },
      data: { status: 'settled', closedAt: now },
    });
    return settled;
  });
  console.log(
    `[Billing] Settled hold ${hold.id} (${hold.referenceId}): charged ${result.charged} of reserved ${hold.amount}`,
  );
  logUncovered(hold.userId, hold.referenceId, result);
  return result;
}

/** Uvolní rezervaci bez odečtu (volání selhalo dřív, než vznikla spotřeba). */
export async function releaseCreditHold(hold: Pick<CreditHoldHandle, 'id'>): Promise<boolean> {
  const { count } = await prisma.creditHold.updateMany({
    where: { id: hold.id, status: 'active' },
    data: { status: 'released', closedAt: new Date() },
  });
  return count > 0;
}

/** Uvolní aktivní rezervace jobů (úklid po pádu workeru, konec jobu). */
export async function releaseJobHolds(jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const { count } = await prisma.creditHold.updateMany({
    where: { jobId: { in: jobIds }, status: 'active' },
    data: { status: 'released', closedAt: new Date() },
  });
  if (count > 0)
    console.log(`[Billing] Released ${count} orphaned hold(s) of ${jobIds.length} job(s)`);
  return count;
}

/**
 * Uvolní všechny aktivní rezervace jobů – volá se při startu workeru, kdy
 * žádný job legitimně neběží (jediná instance). Pokryje i zrušené a chybové
 * joby, které by jinak držely kredit až do vypršení TTL.
 */
export async function releaseAllJobHolds(): Promise<number> {
  const { count } = await prisma.creditHold.updateMany({
    where: { jobId: { not: null }, status: 'active' },
    data: { status: 'released', closedAt: new Date() },
  });
  if (count > 0) console.log(`[Billing] Released ${count} hold(s) of jobs at worker startup`);
  return count;
}

/** Uvolní rezervace po vypršení TTL (pád webu uprostřed volání). */
export async function releaseExpiredHolds(now = new Date()): Promise<number> {
  const { count } = await prisma.creditHold.updateMany({
    where: { status: 'active', expiresAt: { lt: now } },
    data: { status: 'released', closedAt: now },
  });
  if (count > 0) console.log(`[Billing] Released ${count} expired hold(s)`);
  return count;
}

/**
 * Odečte pevnou částku jen tehdy, když na ni stačí volný kredit (bez volání LLM,
 * např. deduplikovaná kopie OCR). Idempotentní podle `referenceId`.
 *
 * `effect` (např. zápis kopie dokumentu) běží v TÉŽE transakci jako odečet:
 * když selže, odečet se vrátí – uživatel nezaplatí za nic. U už zapsaného
 * odečtu (opakovaný běh) se `effect` provede bez nového odečtu.
 */
export async function consumeCredits<T = undefined>(
  userId: string,
  charge: CreditCharge,
  effect?: (tx: Tx, charged: SettleResult) => Promise<T>,
): Promise<
  { ok: true; result: SettleResult; value: T | undefined } | ({ ok: false } & CreditShortage)
> {
  const required = chargeCredits(charge);
  return withUserLock(userId, async (tx) => {
    const existing = await tx.tokenTransaction.findFirst({
      where: { userId, referenceId: charge.referenceId },
      select: { id: true, amount: true },
    });
    let result: SettleResult;
    if (existing) {
      result = {
        charged: 0,
        uncovered: 0,
        transactions: [
          {
            referenceId: charge.referenceId,
            id: existing.id,
            amount: existing.amount,
            existing: true,
          },
        ],
      };
    } else {
      const state = await readCreditState(tx, userId);
      if (state.available < required) return { ok: false as const, required, ...state };
      result = await writeCharges(tx, userId, [charge], state.available);
    }
    const value = effect ? await effect(tx, result) : undefined;
    return { ok: true as const, result, value };
  });
}

export type BillingOutcome = { ok: true; settle: SettleResult } | { ok: false; error: unknown };

/**
 * Placené volání s rezervací: rezervuje `amount`, provede `call`, vyúčtuje
 * skutečnou spotřebu (`usage`) a zbytek vrátí. Když `call` vyhodí, vyúčtuje
 * spotřebu z chyby (`errorUsage`, např. odmítnutí modelem) nebo rezervaci
 * uvolní, a chybu propustí dál.
 *
 * Chyba samotného vyúčtování (DB) výsledek nezahodí – je už zaplacený
 * Anthropicu; vrátí se v `billing` a rezervace se uvolní.
 *
 * @throws InsufficientCreditError, pokud volný kredit na rezervaci nestačí
 */
export async function runBilledCall<T>(
  reserve: ReserveParams,
  call: (hold: CreditHoldHandle) => Promise<T>,
  usage: (result: T) => CreditCharge[],
  errorUsage?: (err: unknown) => CreditCharge[] | null,
): Promise<{ result: T; billing: BillingOutcome }> {
  const hold = await reserveCreditsOrThrow(reserve);
  let result: T;
  try {
    result = await call(hold);
  } catch (err) {
    const charges = errorUsage?.(err) ?? null;
    if (charges && charges.length > 0) {
      await settleCreditHold(hold, charges).catch((billingErr: unknown) => {
        console.error(
          `[Billing] Settlement after failed call failed (${hold.referenceId}):`,
          billingErr,
        );
        return releaseCreditHold(hold).catch(() => false);
      });
    } else {
      await releaseCreditHold(hold).catch((releaseErr: unknown) => {
        console.error(`[Billing] Release of hold ${hold.id} failed:`, releaseErr);
      });
    }
    throw err;
  }
  try {
    return { result, billing: { ok: true, settle: await settleCreditHold(hold, usage(result)) } };
  } catch (error) {
    console.error(`[Billing] Settlement failed (${hold.referenceId}):`, error);
    await releaseCreditHold(hold).catch(() => false);
    return { result, billing: { ok: false, error } };
  }
}

/**
 * `referenceId` odečtů uživatele začínající `prefix` – jedním dotazem. Opakovaný
 * běh jobu (reclaim po pádu workeru) podle nich přeskočí kroky, za které už
 * zaplatil: vyúčtování by kvůli existujícímu `referenceId` nic neodečetlo
 * a nové volání modelu by platil provozovatel.
 */
export async function chargedReferenceIds(userId: string, prefix: string): Promise<Set<string>> {
  const rows = await prisma.tokenTransaction.findMany({
    where: { userId, referenceId: { startsWith: prefix } },
    select: { referenceId: true },
  });
  return new Set(rows.flatMap((r) => (r.referenceId ? [r.referenceId] : [])));
}

/** Kredity skutečně odečtené vyúčtováním (včetně položek zapsaných dřívějším během). */
export function settledCredits(result: SettleResult): number {
  return result.transactions.reduce((sum, tr) => sum - tr.amount, 0);
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
