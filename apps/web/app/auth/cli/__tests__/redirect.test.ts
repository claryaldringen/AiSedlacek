import { describe, it, expect } from 'vitest';
import { buildCliCallbackUrl, parseCliRedirect } from '../redirect';

describe('parseCliRedirect', () => {
  it.each([
    'http://127.0.0.1:54321/callback',
    'http://localhost:54321/callback',
    'http://[::1]:54321/callback',
    'http://LOCALHOST:8080/callback',
  ])('accepts loopback callback %s', (redirect) => {
    expect(parseCliRedirect(redirect)).not.toBeNull();
  });

  it.each([
    ['short IPv4', 'http://127.1:5000/callback'],
    ['hex IPv4', 'http://0x7f000001:5000/callback'],
    ['decimal IPv4', 'http://2130706433:5000/callback'],
    ['expanded IPv6', 'http://[0:0::1]:5000/callback'],
    ['backslash path', 'http://127.0.0.1:5000\\callback'],
  ])('normalises %s to a loopback callback', (_name, redirect) => {
    const url = parseCliRedirect(redirect);
    expect(url?.protocol).toBe('http:');
    expect(url?.pathname).toBe('/callback');
    expect(['127.0.0.1', '[::1]']).toContain(url?.hostname);
  });

  it('accepts the URL built by `ais login` (current and previous CLI versions)', () => {
    for (const host of ['127.0.0.1', 'localhost']) {
      const redirect = `http://${host}:61234/callback`;
      // CLI posílá redirect URL-enkódovaný v query; useSearchParams ho vrátí dekódovaný.
      const query = new URLSearchParams(`state=abc&redirect=${encodeURIComponent(redirect)}`);
      expect(parseCliRedirect(query.get('redirect'))?.port).toBe('61234');
    }
  });

  it.each([
    // SEC-5: ne-HTTP schémata s loopback hostname
    'javascript://localhost:1234/callback%0Aalert(document.cookie)',
    'javascript://localhost/%0Aalert(1)',
    'data://localhost:1234/callback',
    'file://localhost/etc/passwd',
    'vbscript://localhost:1234/callback',
    'ftp://localhost:1234/callback',
    'https://localhost:1234/callback',
    'ws://localhost:1234/callback',
    'java\nscript://localhost:1234/callback',
    ' javascript://localhost:1234/callback',
    'java\tscript://localhost:1234/callback',
  ])('rejects non-http scheme %s', (redirect) => {
    expect(parseCliRedirect(redirect)).toBeNull();
  });

  it.each([
    'http://evil.example:1234/callback',
    'http://localhost.evil.example:1234/callback',
    'http://127.0.0.1.nip.io:1234/callback',
    'http://192.168.1.10:1234/callback',
    'http://0.0.0.0:1234/callback',
    'http://localhost.:1234/callback',
    'http://[::ffff:127.0.0.1]:1234/callback',
    'http://127.0.0.1@evil.example:1234/callback',
  ])('rejects non-loopback host %s', (redirect) => {
    expect(parseCliRedirect(redirect)).toBeNull();
  });

  it.each([
    ['without port', 'http://localhost/callback'],
    ['with default port', 'http://localhost:80/callback'],
    ['with port 0', 'http://localhost:0/callback'],
    ['with credentials', 'http://user:pass@localhost:1234/callback'],
    ['with another path', 'http://localhost:1234/'],
    ['with path prefix', 'http://localhost:1234/callback/../x'],
    ['with longer path', 'http://localhost:1234/callback/extra'],
  ])('rejects redirect %s', (_name, redirect) => {
    expect(parseCliRedirect(redirect)).toBeNull();
  });

  it.each([null, undefined, '', 'not a url', '/callback', '//localhost:1234/callback'])(
    'rejects invalid input %s',
    (redirect) => {
      expect(parseCliRedirect(redirect)).toBeNull();
    },
  );
});

describe('buildCliCallbackUrl', () => {
  it('appends encoded token and state and overrides injected values', () => {
    const redirect = parseCliRedirect('http://127.0.0.1:5000/callback?token=evil&state=evil');
    expect(redirect).not.toBeNull();

    const result = new URL(buildCliCallbackUrl(redirect!, 'tok&en=1', 'st#ate'));

    expect(result.protocol).toBe('http:');
    expect(result.host).toBe('127.0.0.1:5000');
    expect(result.pathname).toBe('/callback');
    expect(result.searchParams.getAll('token')).toEqual(['tok&en=1']);
    expect(result.searchParams.getAll('state')).toEqual(['st#ate']);
  });
});
