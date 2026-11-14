/**
 * Sdílená náhrada `@ai-sedlacek/db/billing` pro testy handlerů workeru.
 *
 * Použití v testu:
 *
 *   vi.mock('@ai-sedlacek/db/billing', async () => (await import('./billing-mock')).billingModule());
 *   import { billing } from './billing-mock';
 *
 * Rezervace standardně projdou, vyúčtování jen zaznamená položky – testy čtou
 * `charges()` (všechny položky předané do `settleCreditHold`/`consumeCredits`).
 * Logika rezervací a stropů samotná je testovaná v packages/db.
 */
import { vi } from 'vitest';
import { creditsForUsage } from '@ai-sedlacek/shared';
import type * as Billing from '@ai-sedlacek/db/billing';

type CreditCharge = Billing.CreditCharge;

class InsufficientCreditError extends Error {
  readonly code = 'insufficient_credit';
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Nedostatečný kredit: akce potřebuje ${required} kreditů, volných je ${available}`);
    this.name = 'InsufficientCreditError';
  }
}

/** Vyúčtování „naostro" podle ceníku – bez stropu, každá položka nová. */
function settleOf(charges: CreditCharge[]): Billing.SettleResult {
  const transactions = charges.map((c, i) => {
    const credits = c.credits ?? creditsForUsage(c.model, c.inputTokens, c.outputTokens);
    return { referenceId: c.referenceId, id: `tr-${i}`, amount: -credits, existing: false };
  });
  return {
    charged: transactions.reduce((n, t) => n - t.amount, 0),
    uncovered: 0,
    transactions,
  };
}

export const billing = {
  InsufficientCreditError,
  getCreditState: vi.fn(),
  reserveCredits: vi.fn(),
  settleCreditHold: vi.fn(),
  releaseCreditHold: vi.fn(),
  consumeCredits: vi.fn(),
  releaseJobHolds: vi.fn(),
  releaseExpiredHolds: vi.fn(),
  runBilledCall: vi.fn(),
  settledCredits: (result: Billing.SettleResult): number =>
    result.transactions.reduce((sum, tr) => sum - tr.amount, 0),
};

/** Výchozí chování: dost kreditu, rezervace i vyúčtování projdou. */
export function resetBillingMock(available = 1_000_000_000): void {
  billing.getCreditState
    .mockReset()
    .mockResolvedValue({ balance: available, reserved: 0, available });
  billing.reserveCredits.mockReset().mockImplementation(async (p: Billing.ReserveParams) => ({
    ok: true,
    hold: {
      id: `hold:${p.referenceId}`,
      userId: p.userId,
      amount: p.amount,
      referenceId: p.referenceId,
    },
  }));
  billing.settleCreditHold
    .mockReset()
    .mockImplementation(async (_hold: unknown, charges: CreditCharge[]) => settleOf(charges));
  billing.releaseCreditHold.mockReset().mockResolvedValue(true);
  billing.consumeCredits
    .mockReset()
    .mockImplementation(async (_userId: string, charge: CreditCharge) => ({
      ok: true,
      result: settleOf([charge]),
    }));
  billing.releaseJobHolds.mockReset().mockResolvedValue(0);
  billing.releaseExpiredHolds.mockReset().mockResolvedValue(0);
  // Stejný tok jako skutečné runBilledCall, nad mocky výše.
  billing.runBilledCall
    .mockReset()
    .mockImplementation(
      async <T>(
        reserve: Billing.ReserveParams,
        call: (hold: Billing.CreditHoldHandle) => Promise<T>,
        usage: (result: T) => CreditCharge[],
        errorUsage?: (err: unknown) => CreditCharge[] | null,
      ) => {
        const r = (await billing.reserveCredits(reserve)) as Billing.ReserveResult;
        if (!r.ok) throw new InsufficientCreditError(r.required, r.available);
        let result: T;
        try {
          result = await call(r.hold);
        } catch (err) {
          const charges = errorUsage?.(err) ?? null;
          if (charges?.length) await billing.settleCreditHold(r.hold, charges);
          else await billing.releaseCreditHold(r.hold);
          throw err;
        }
        try {
          return {
            result,
            billing: { ok: true, settle: await billing.settleCreditHold(r.hold, usage(result)) },
          };
        } catch (error) {
          await billing.releaseCreditHold(r.hold);
          return { result, billing: { ok: false, error } };
        }
      },
    );
}

/** Továrna modulu pro `vi.mock('@ai-sedlacek/db/billing', …)`. */
export function billingModule(): Record<string, unknown> {
  resetBillingMock();
  return billing;
}

/** Všechny vyúčtované položky v pořadí volání. */
export function charges(): CreditCharge[] {
  return [
    ...billing.settleCreditHold.mock.calls.flatMap((c) => c[1] as CreditCharge[]),
    ...billing.consumeCredits.mock.calls.map((c) => c[1] as CreditCharge),
  ];
}

/** Rezervace odmítnutá pro nedostatek kreditu. */
export function refuseReservations(available = 0, required = 500_000): void {
  billing.getCreditState.mockResolvedValue({ balance: available, reserved: 0, available });
  billing.reserveCredits.mockResolvedValue({ ok: false, required, available });
  billing.consumeCredits.mockResolvedValue({ ok: false, required, available });
}
