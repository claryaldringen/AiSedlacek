import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from '../safe-callback-url';

const origin = 'https://aisedlacek.com';

describe('safeCallbackUrl', () => {
  it('keeps internal paths including query', () => {
    expect(safeCallbackUrl('/cs/workspace', origin)).toBe('/cs/workspace');
    expect(
      safeCallbackUrl(
        '/auth/cli?state=abc&redirect=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback',
        origin,
      ),
    ).toBe('/auth/cli?state=abc&redirect=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback');
  });

  it.each([
    'https://evil.com/',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    'javascript:alert(1)',
    '/.//evil.com',
    '/a/..//evil.com',
    '/%2e//evil.com',
    '',
    null,
  ])('rejects %s', (raw) => {
    expect(safeCallbackUrl(raw, origin)).toBe('/workspace');
  });
});
