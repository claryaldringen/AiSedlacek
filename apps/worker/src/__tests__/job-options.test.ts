import { describe, it, expect, vi } from 'vitest';
import { parseOcrJobOptions } from '../lib/job-options';

vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('parseOcrJobOptions (DAT-1)', () => {
  it('rozpozná regeneraci z jobData', () => {
    expect(parseOcrJobOptions(JSON.stringify({ regenerate: true }))).toEqual({ regenerate: true });
  });

  it('bez jobData nebo s jinou hodnotou je to běžné zpracování', () => {
    expect(parseOcrJobOptions(null)).toEqual({ regenerate: false });
    expect(parseOcrJobOptions(undefined)).toEqual({ regenerate: false });
    expect(parseOcrJobOptions('{}')).toEqual({ regenerate: false });
    expect(parseOcrJobOptions('{"regenerate":"true"}')).toEqual({ regenerate: false });
    expect(parseOcrJobOptions('null')).toEqual({ regenerate: false });
  });

  it('neplatný JSON job neshodí', () => {
    expect(parseOcrJobOptions('{nevalidní')).toEqual({ regenerate: false });
  });
});
