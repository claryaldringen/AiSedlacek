import { describe, it, expect } from 'vitest';
import { jobErrorMessageKey, jobOutcomeMessageKey } from '../job-errors';
import cs from '../../messages/cs.json';
import en from '../../messages/en.json';

describe('jobErrorMessageKey', () => {
  it('nedostatek kreditu → lokalizovaná hláška s výzvou k dobití', () => {
    expect(jobErrorMessageKey('insufficient_credit')).toBe('jobInsufficientCredit');
    expect(cs.workspace.jobInsufficientCredit).toMatch(/Dobijte tokeny/);
    expect(en.workspace.jobInsufficientCredit).toMatch(/Top up/);
  });

  it('kredit blokovaný jiným zpracováním → spustit znovu později, ne dobíjet', () => {
    expect(jobErrorMessageKey('credit_busy')).toBe('jobCreditBusy');
    expect(cs.workspace.jobCreditBusy).toMatch(/dočasně rezervovaný jiným běžícím zpracováním/);
    expect(en.workspace.jobCreditBusy).toMatch(/temporarily reserved by another running job/);
  });

  it('jiné nebo neznámé kódy nechají obecnou hlášku volajícího', () => {
    expect(jobErrorMessageKey('api_error')).toBeNull();
    expect(jobErrorMessageKey(null)).toBeNull();
    expect(jobErrorMessageKey('nesmysl')).toBeNull();
  });
});

describe('jobOutcomeMessageKey', () => {
  it('chyba jobu: stejné klíče jako jobErrorMessageKey', () => {
    expect(jobOutcomeMessageKey('error', 'insufficient_credit')).toBe('jobInsufficientCredit');
    expect(jobOutcomeMessageKey('error', 'credit_busy')).toBe('jobCreditBusy');
    expect(jobOutcomeMessageKey('error', 'api_error')).toBeNull();
  });

  it('doběhlý job, který kvůli kreditu přeskočil část stránek → upozornění s výzvou k dobití', () => {
    expect(jobOutcomeMessageKey('completed', 'insufficient_credit')).toBe(
      'jobPartialInsufficientCredit',
    );
    expect(cs.workspace.jobPartialInsufficientCredit).toMatch(/Část stránek.*Dobijte tokeny/);
    expect(en.workspace.jobPartialInsufficientCredit).toMatch(/Some pages.*Top up/);
  });

  it('doběhlý job bez kódu a zrušený job hlášku nemají', () => {
    expect(jobOutcomeMessageKey('completed', null)).toBeNull();
    expect(jobOutcomeMessageKey('cancelled', 'insufficient_credit')).toBeNull();
  });
});
