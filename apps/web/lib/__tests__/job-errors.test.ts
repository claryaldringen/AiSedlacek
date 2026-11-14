import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { FIX_CONTEXT_SKIPPED_NOTE } from '@ai-sedlacek/shared';
import { fixContextsCreditMessage, jobErrorMessageKey, jobOutcomeMessageKey } from '../job-errors';
import cs from '../../messages/cs.json';
import en from '../../messages/en.json';

describe('jobErrorMessageKey', () => {
  it('nedostatek kreditu → lokalizovaná hláška s výzvou k dobití', () => {
    expect(jobErrorMessageKey('insufficient_credit', 'ocr')).toBe('jobInsufficientCredit');
    expect(jobErrorMessageKey('insufficient_credit', 'text')).toBe('jobInsufficientCredit');
    expect(cs.workspace.jobInsufficientCredit).toMatch(/Dobijte tokeny/);
    expect(en.workspace.jobInsufficientCredit).toMatch(/Top up/);
  });

  it('kredit blokovaný jiným zpracováním → spustit znovu později, ne dobíjet', () => {
    expect(jobErrorMessageKey('credit_busy', 'ocr')).toBe('jobCreditBusy');
    expect(cs.workspace.jobCreditBusy).toMatch(/dočasně rezervovaný jiným běžícím zpracováním/);
    expect(en.workspace.jobCreditBusy).toMatch(/temporarily reserved by another running job/);
  });

  it('textové joby (kontexty, retranslace) nemluví o nedokončených stránkách', () => {
    expect(jobErrorMessageKey('credit_busy', 'text')).toBe('jobCreditBusyText');
    expect(cs.workspace.jobCreditBusy).toMatch(/stránky/);
    expect(cs.workspace.jobCreditBusyText).not.toMatch(/stránk/);
    expect(en.workspace.jobCreditBusyText).not.toMatch(/page/);
    expect(cs.workspace.jobCreditBusyText).toMatch(/dobíjet netřeba/);
  });

  it('jiné nebo neznámé kódy nechají obecnou hlášku volajícího', () => {
    expect(jobErrorMessageKey('api_error', 'ocr')).toBeNull();
    expect(jobErrorMessageKey(null, 'text')).toBeNull();
    expect(jobErrorMessageKey('nesmysl', 'ocr')).toBeNull();
  });
});

describe('jobOutcomeMessageKey', () => {
  it('chyba jobu: stejné klíče jako jobErrorMessageKey', () => {
    expect(jobOutcomeMessageKey('error', 'insufficient_credit', 'ocr')).toBe(
      'jobInsufficientCredit',
    );
    expect(jobOutcomeMessageKey('error', 'credit_busy', 'ocr')).toBe('jobCreditBusy');
    expect(jobOutcomeMessageKey('error', 'credit_busy', 'text')).toBe('jobCreditBusyText');
    expect(jobOutcomeMessageKey('error', 'api_error', 'ocr')).toBeNull();
  });

  it('doběhlý job, který kvůli kreditu přeskočil část stránek → upozornění s výzvou k dobití', () => {
    expect(jobOutcomeMessageKey('completed', 'insufficient_credit', 'ocr')).toBe(
      'jobPartialInsufficientCredit',
    );
    expect(cs.workspace.jobPartialInsufficientCredit).toMatch(/Část stránek.*Dobijte tokeny/);
    expect(en.workspace.jobPartialInsufficientCredit).toMatch(/Some pages.*Top up/);
  });

  it('doběhlý job bez kódu a zrušený job hlášku nemají', () => {
    expect(jobOutcomeMessageKey('completed', null, 'ocr')).toBeNull();
    expect(jobOutcomeMessageKey('cancelled', 'insufficient_credit', 'ocr')).toBeNull();
  });
});

describe('fixContextsCreditMessage – oprava kontextů zastavená kvůli kreditu', () => {
  it('řekne, kolik je opraveno, a že nové spuštění opraví všechny dokumenty znovu', () => {
    expect(
      fixContextsCreditMessage('error', 'insufficient_credit', { completed: 3, total: 10 }),
    ).toEqual({
      key: 'fixContextsInsufficientCredit',
      values: { fixed: 3, total: 10, skipped: 0 },
    });
    expect(fixContextsCreditMessage('error', 'credit_busy', { completed: 0, total: 4 })).toEqual({
      key: 'fixContextsCreditBusy',
      values: { fixed: 0, total: 4, skipped: 0 },
    });
    for (const messages of [cs, en]) {
      for (const key of ['fixContextsInsufficientCredit', 'fixContextsCreditBusy'] as const) {
        expect(messages.workspace[key]).toContain('{fixed}');
        expect(messages.workspace[key]).toContain('{total}');
      }
    }
    expect(cs.workspace.fixContextsCreditBusy).toMatch(/opraví znovu všechny dokumenty svazku/);
    expect(en.workspace.fixContextsInsufficientCredit).toMatch(/fixes all documents/);
  });

  // Po reclaimu: dokumenty zaplacené v přerušeném běhu se přeskočí – nejsou
  // opravené v tomto běhu (oprava se tehdy nemusela uložit), vykazují se zvlášť.
  it('přeskočené dokumenty spočítá z poznámek v errors a nehlásí je jako opravené', () => {
    const errors = [
      'Přerušeno restartem workeru (obnova 1/2)',
      `Dokument doc-1: ${FIX_CONTEXT_SKIPPED_NOTE}`,
      `Dokument doc-2: ${FIX_CONTEXT_SKIPPED_NOTE}`,
      'Dokument doc-3: Model nevrátil kompletní kontext (refusal) – kontext zůstal beze změny',
      'Nedostatečný kredit … – oprava kontextů zastavena, opraveno 1 z 5 dokumentů',
    ];
    const message = fixContextsCreditMessage(
      'error',
      'insufficient_credit',
      { completed: 1, total: 5 },
      errors,
    );
    expect(message).toEqual({
      key: 'fixContextsInsufficientCredit',
      values: { fixed: 1, total: 5, skipped: 2 },
    });

    const tCs = createTranslator({ locale: 'cs', messages: cs, namespace: 'workspace' });
    const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'workspace' });
    expect(tCs(message!.key, message!.values)).toContain(
      'Opraveno 1 z 5 dokumentů. 2 dokumenty přeskočeny – zpracoval je už přerušený běh',
    );
    expect(tEn(message!.key, message!.values)).toContain(
      '1 of 5 documents fixed. 2 documents skipped – an interrupted run already processed them',
    );
    // Bez přeskočených věta o přeskočení chybí; jednotné číslo
    expect(tCs('fixContextsCreditBusy', { fixed: 0, total: 4, skipped: 0 })).toContain(
      'Opraveno 0 z 4 dokumentů. Nové spuštění',
    );
    expect(tCs('fixContextsCreditBusy', { fixed: 0, total: 4, skipped: 1 })).toContain(
      '1 dokument přeskočen',
    );
    expect(tEn('fixContextsInsufficientCredit', { fixed: 2, total: 4, skipped: 0 })).toContain(
      '2 of 4 documents fixed. Top up',
    );
  });

  it('jiný výsledek nebo kód → null (obecná hláška)', () => {
    expect(fixContextsCreditMessage('completed', 'insufficient_credit', null)).toBeNull();
    expect(fixContextsCreditMessage('error', 'api_error', { completed: 1, total: 2 })).toBeNull();
  });
});
