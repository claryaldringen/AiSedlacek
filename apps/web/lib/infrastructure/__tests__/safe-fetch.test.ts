import { describe, it, expect } from 'vitest';
import { isBlockedAddress, assertSafeUrl, UnsafeUrlError } from '../safe-fetch';

describe('isBlockedAddress', () => {
  it('blocks IPv4 private / loopback / link-local / metadata ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.0.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public IPv4 addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('blocks IPv6 loopback / link-local / unique-local and mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl('ftp://example.com/x')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects literal private/metadata IPs without DNS', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(assertSafeUrl('http://127.0.0.1:5432')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl('http://[::1]/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects malformed URLs', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('accepts a public literal IP', async () => {
    const u = await assertSafeUrl('https://8.8.8.8/');
    expect(u.protocol).toBe('https:');
  });
});
