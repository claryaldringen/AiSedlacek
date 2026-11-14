import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { JobError, describeJobError } from '../lib/job-error';

describe('describeJobError – kód chyby jobu pro lokalizaci v UI', () => {
  it('JobError předá svůj kód i text', () => {
    expect(describeJobError(new JobError('translation_changed', 'Překlad byl upraven'))).toEqual({
      code: 'translation_changed',
      message: 'Překlad byl upraven',
    });
  });

  it('nedostatek kreditu pozná podle kódu chyby billingu', () => {
    const err = Object.assign(new Error('Nedostatečný kredit'), { code: 'insufficient_credit' });
    expect(describeJobError(err).code).toBe('insufficient_credit');
  });

  it('chyba API: do jobu jde obecný text se stavem, ne surová zpráva SDK', () => {
    const err = new Anthropic.APIError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      new Headers(),
    );
    const described = describeJobError(err);
    expect(described.code).toBe('api_error');
    expect(described.message).toBe('Chyba služby Claude API 529 – zkuste to znovu');
    expect(described.message).not.toContain('overloaded_error');
  });

  it('výpadek spojení s API je také api_error', () => {
    const err = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(describeJobError(err).code).toBe('api_error');
  });

  it('ostatní chyby jsou unknown s původním textem', () => {
    expect(describeJobError(new Error('něco'))).toEqual({ code: 'unknown', message: 'něco' });
    expect(describeJobError('x')).toEqual({ code: 'unknown', message: 'Neznámá chyba' });
  });
});
