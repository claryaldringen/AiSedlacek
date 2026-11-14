/**
 * Kredit před placenou akcí (BIL-1): předběžná kontrola v routách a jednotná
 * odpověď, když volný kredit (zůstatek − rezervace běžících akcí) nestačí na
 * rezervaci maximální ceny volání:
 * - 402 `insufficient_credit` – kredit opravdu chybí, je potřeba dobít;
 * - 409 `credit_busy` – zůstatek by stačil, ale blokují ho rezervace jiných
 *   běžících akcí uživatele; stačí spustit znovu po jejich dokončení.
 */
import { NextResponse } from 'next/server';
// Čistá funkce přímo z balíčku – testy rout mockují jen '@/lib/infrastructure/billing'
import { isBlockedByOtherHolds } from '@ai-sedlacek/db/billing';
import { checkBalance } from './billing';
import { getLocaleFromRequest } from './api-locale';

type Translator = (key: string, values?: Record<string, string | number>) => string;

interface CreditShortfall {
  required: number;
  available: number;
  balance?: number;
  /** Kredit blokovaný jinými aktivními rezervacemi uživatele. */
  reserved?: number;
}

/** HTTP stav odmítnutí: 409 při kreditu blokovaném jinými akcemi, jinak 402. */
export function creditRefusalStatus(credit: CreditShortfall): 402 | 409 {
  return isBlockedByOtherHolds(credit) ? 409 : 402;
}

/**
 * Tělo odmítnutí s lokalizovanou hláškou: u `credit_busy` výzva spustit akci
 * znovu po dokončení běžícího zpracování, jinak kolik volného kreditu akce
 * potřebuje a kolik je.
 */
export function insufficientCreditBody(
  request: Request,
  t: Translator,
  credit: CreditShortfall,
): Record<string, unknown> {
  const details = {
    required: credit.required,
    available: credit.available,
    ...(credit.balance !== undefined ? { balance: credit.balance } : {}),
  };
  if (isBlockedByOtherHolds(credit)) {
    return { error: t('creditBusy'), code: 'credit_busy', ...details };
  }
  const format = (n: number): string =>
    Math.max(0, n).toLocaleString(getLocaleFromRequest(request));
  return {
    error: t('insufficientCreditDetail', {
      required: format(credit.required),
      available: format(credit.available),
    }),
    code: 'insufficient_credit',
    ...details,
  };
}

/** Odpověď 402/409 – viz `insufficientCreditBody` a `creditRefusalStatus`. */
export function insufficientCreditResponse(
  request: Request,
  t: Translator,
  credit: CreditShortfall,
): NextResponse {
  return NextResponse.json(insufficientCreditBody(request, t, credit), {
    status: creditRefusalStatus(credit),
  });
}

/**
 * Předběžná kontrola před založením jobu: stačí volný kredit na rezervaci
 * prvního volání? Závazná rezervace proběhne ve workeru těsně před voláním
 * modelu – tady se jen dřív odmítne akce, která by stejně neprošla.
 *
 * @returns odpověď 402 (`insufficient_credit`) či 409 (`credit_busy`), nebo
 *   null, když kredit stačí
 */
export async function requireCredit(
  request: Request,
  t: Translator,
  userId: string,
  required: number,
): Promise<NextResponse | null> {
  const state = await checkBalance(userId, required);
  return state.sufficient ? null : insufficientCreditResponse(request, t, state);
}
