import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from '../version.js';

describe('CLI_VERSION', () => {
  it('odpovídá verzi v package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });
});
