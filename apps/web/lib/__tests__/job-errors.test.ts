import { describe, it, expect } from 'vitest';
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
    ).toEqual({ key: 'fixContextsInsufficientCredit', values: { fixed: 3, total: 10 } });
    expect(fixContextsCreditMessage('error', 'credit_busy', { completed: 0, total: 4 })).toEqual({
      key: 'fixContextsCreditBusy',
      values: { fixed: 0, total: 4 },
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

  it('jiný výsledek nebo kód → null (obecná hláška)', () => {
    expect(fixContextsCreditMessage('completed', 'insufficient_credit', null)).toBeNull();
    expect(fixContextsCreditMessage('error', 'api_error', { completed: 1, total: 2 })).toBeNull();
  });
});
