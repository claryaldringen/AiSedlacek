/**
 * Kredit před placenou akcí (BIL-1): předběžná kontrola v routách a jednotná
 * odpověď 402, když volný kredit (zůstatek − rezervace běžících akcí) nestačí
 * na rezervaci maximální ceny volání.
 */
import { NextResponse } from 'next/server';
import { checkBalance } from './billing';
import { getLocaleFromRequest } from './api-locale';

type Translator = (key: string, values?: Record<string, string | number>) => string;

interface CreditShortfall {
  required: number;
  available: number;
  balance?: number;
}

/** Tělo odpovědi 402 s lokalizovanou hláškou (kolik volného kreditu akce potřebuje a kolik je). */
export function insufficientCreditBody(
  request: Request,
  t: Translator,
  credit: CreditShortfall,
): Record<string, unknown> {
  const format = (n: number): string =>
    Math.max(0, n).toLocaleString(getLocaleFromRequest(request));
  return {
    error: t('insufficientCreditDetail', {
      required: format(credit.required),
      available: format(credit.available),
    }),
    code: 'insufficient_credit',
    required: credit.required,
    available: credit.available,
    ...(credit.balance !== undefined ? { balance: credit.balance } : {}),
  };
}

/** Odpověď 402 – viz `insufficientCreditBody`. */
export function insufficientCreditResponse(
  request: Request,
  t: Translator,
  credit: CreditShortfall,
): NextResponse {
  return NextResponse.json(insufficientCreditBody(request, t, credit), { status: 402 });
}

/**
 * Předběžná kontrola před založením jobu: stačí volný kredit na rezervaci
 * prvního volání? Závazná rezervace proběhne ve workeru těsně před voláním
 * modelu – tady se jen dřív odmítne akce, která by stejně neprošla.
 *
 * @returns 402 odpověď, nebo null, když kredit stačí
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
