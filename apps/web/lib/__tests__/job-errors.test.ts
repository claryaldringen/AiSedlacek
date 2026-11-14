import { describe, it, expect } from 'vitest';
import { jobErrorMessageKey } from '../job-errors';
import cs from '../../messages/cs.json';
import en from '../../messages/en.json';

describe('jobErrorMessageKey', () => {
  it('nedostatek kreditu → lokalizovaná hláška s výzvou k dobití', () => {
    expect(jobErrorMessageKey('insufficient_credit')).toBe('jobInsufficientCredit');
    expect(cs.workspace.jobInsufficientCredit).toMatch(/Dobijte tokeny/);
    expect(en.workspace.jobInsufficientCredit).toMatch(/Top up/);
  });

  it('jiné nebo neznámé kódy nechají obecnou hlášku volajícího', () => {
    expect(jobErrorMessageKey('api_error')).toBeNull();
    expect(jobErrorMessageKey(null)).toBeNull();
    expect(jobErrorMessageKey('nesmysl')).toBeNull();
  });
});
