/**
 * Chyby jobů s kódem pro lokalizaci v UI (`ProcessingJob.errorCode`).
 */

import Anthropic from '@anthropic-ai/sdk';
import { isBlockedByOtherHolds } from '@ai-sedlacek/db/billing';
import type { JobErrorCode } from '@ai-sedlacek/shared';

/** Chyba jobu se známým kódem; `message` (česky) jde do logu a `errors` jobu. */
export class JobError extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

interface Shortage {
  required: number;
  available: number;
  balance?: number;
  reserved?: number;
}

/** Nedostatek kreditu z billingu (InsufficientCreditError nebo odmítnutá rezervace). */
function creditShortage(err: unknown): Shortage | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    code?: unknown;
    required?: unknown;
    available?: unknown;
    balance?: unknown;
    reserved?: unknown;
  };
  if (e.code !== 'insufficient_credit') return null;
  if (typeof e.required !== 'number' || typeof e.available !== 'number') return null;
  return {
    required: e.required,
    available: e.available,
    balance: typeof e.balance === 'number' ? e.balance : undefined,
    reserved: typeof e.reserved === 'number' ? e.reserved : undefined,
  };
}

const fmt = (n: number): string => Math.max(0, n).toLocaleString('cs');

/**
 * Text do `errors` jobu (vidí ho jen vlastník) při nedostatku kreditu. Když kredit
 * blokují jen rezervace jiných běžících akcí uživatele (bez nich by zůstatek
 * stačil), jde o `credit_busy` – spustit znovu po jejich dokončení, nedobíjet.
 */
export function describeCreditShortage(shortage: Shortage): {
  code: JobErrorCode;
  message: string;
} {
  if (isBlockedByOtherHolds(shortage)) {
    return {
      code: 'credit_busy',
      message:
        'Kredit je dočasně rezervovaný jiným běžícím zpracováním – spusťte znovu po jeho dokončení ' +
        `(potřeba ${fmt(shortage.required)} tokenů, zůstatek ${fmt(shortage.balance ?? 0)}, ` +
        `rezervováno ${fmt(shortage.reserved ?? 0)})`,
    };
  }
  return {
    code: 'insufficient_credit',
    message:
      'Nedostatečný kredit pro zpracování – další krok potřebuje rezervovat ' +
      `${fmt(shortage.required)} tokenů, volných je ${fmt(shortage.available)}`,
  };
}

/** Kredit blokovaný jinými běžícími akcemi uživatele (`credit_busy`)? */
export function isCreditBusy(err: unknown): boolean {
  if (err instanceof JobError) return err.code === 'credit_busy';
  const shortage = creditShortage(err);
  return shortage !== null && isBlockedByOtherHolds(shortage);
}

/** Chyba `credit_busy` pro odmítnutou rezervaci / odečet (job skončí, stránky se vrátí). */
export function creditBusyError(shortage: Shortage): JobError {
  return new JobError('credit_busy', describeCreditShortage(shortage).message);
}

/**
 * Kód a text chyby pro zápis do jobu. Surová zpráva SDK (chyby API) jde jen do
 * logu – v `errors` je obecný text se stavovým kódem, v UI lokalizovaná hláška.
 */
export function describeJobError(err: unknown): { code: JobErrorCode; message: string } {
  if (err instanceof JobError) return { code: err.code, message: err.message };
  // InsufficientCreditError z @ai-sedlacek/db/billing (podle kódu – bez závislosti
  // na konkrétní instanci třídy, kterou testy mockují)
  const shortage = creditShortage(err);
  if (shortage) return describeCreditShortage(shortage);
  if (err instanceof Anthropic.APIError) {
    const status = err.status ? ` ${err.status}` : '';
    return { code: 'api_error', message: `Chyba služby Claude API${status} – zkuste to znovu` };
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : 'Neznámá chyba' };
}

/**
 * Hláška chyby pro `Page.errorMessage` – vidí ji i členové sdíleného workspace,
 * proto bez surových chyb SDK či Prismy (ty jen do logu) a bez částek kreditu.
 * Vlastní chyby se známým kódem (useknutý výstup, odmítnutí…) projdou, chyba API
 * dostane obecný text, ostatní `fallback`.
 */
export function pageErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof JobError && err.code !== 'credit_busy' && err.code !== 'insufficient_credit') {
    return err.message;
  }
  if (creditShortage(err) || err instanceof JobError) {
    return 'Nedostatečný kredit – stránka nebyla zpracována';
  }
  if (err instanceof Anthropic.APIError) return describeJobError(err).message;
  return fallback;
}
