import os from 'node:os';
import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('blocks IPv4-mapped IPv6 in hex notation (WHATWG URL normalizes to it)', () => {
    // new URL('http://[::ffff:169.254.169.254]/').hostname === '[::ffff:a9fe:a9fe]'
    for (const ip of [
      '::ffff:a9fe:a9fe',
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '::FFFF:A9FE:A9FE',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blocks IPv6 forms that embed a private IPv4 (compat, NAT64, 6to4)', () => {
    for (const ip of [
      '::127.0.0.1', // IPv4-compatible (deprecated)
      '::7f00:1',
      '64:ff9b::a9fe:a9fe', // NAT64
      '64:ff9b::10.0.0.1',
      '2002:7f00:1::', // 6to4 → 127.0.0.1
      '2002:a9fe:a9fe::1',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blocks Teredo, documentation and site-local IPv6 and malformed input', () => {
    for (const ip of [
      '2001:0:4136:e378::1',
      '2001:db8::1',
      'fec0::1',
      'ff02::1',
      '1::2::3',
      'gggg::',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows IPv6 forms that embed a public IPv4', () => {
    expect(isBlockedAddress('::ffff:808:808')).toBe(false); // 8.8.8.8
    expect(isBlockedAddress('64:ff9b::808:808')).toBe(false);
    expect(isBlockedAddress('2002:808:808::1')).toBe(false);
  });
});

/**
 * Ověří, že URL je odmítnuta a z jakého důvodu. Samotné `UnsafeUrlError` nestačí –
 * např. nepovolený port by odmítl URL dřív, než se vůbec zkontroluje adresa.
 */
async function expectRejected(url: string, reason: RegExp): Promise<void> {
  const err = await assertSafeUrl(url).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, url).toBeInstanceOf(UnsafeUrlError);
  expect((err as Error).message, url).toMatch(reason);
}

describe('assertSafeUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    await expectRejected('file:///etc/passwd', /only http\/https/);
    await expectRejected('ftp://example.com/x', /only http\/https/);
  });

  it('rejects literal private/metadata IPs without DNS', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://127.0.0.1/',
      'http://[::1]/',
    ]) {
      await expectRejected(url, /^blocked address/);
    }
  });

  it('rejects IPv4-mapped IPv6 literals regardless of notation', async () => {
    for (const url of [
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[64:ff9b::7f00:1]/',
    ]) {
      await expectRejected(url, /^blocked address/);
    }
  });

  it('rejects non-standard ports', async () => {
    await expectRejected('http://8.8.8.8:5432/', /^port not allowed/);
    await expectRejected('http://8.8.8.8:3003/', /^port not allowed/);
    await expect(assertSafeUrl('https://8.8.8.8:8443/')).resolves.toBeInstanceOf(URL);
  });

  it("rejects addresses of the server's own network interfaces", async () => {
    // Na VPS má eth0 veřejnou IP – request na ni jde přes loopback mimo firewall.
    const ownPublic = Object.values(os.networkInterfaces())
      .flat()
      .find((e) => e && e.family === 'IPv4' && !e.internal && !isBlockedAddress(e.address));
    if (!ownPublic) return; // stroj bez veřejné IPv4 na rozhraní (typicky vývojářský notebook za NAT)
    await expectRejected(`http://${ownPublic.address}/`, /^blocked address/);
  });

  describe("server's own interfaces (mocked)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function mockInterfaces(): void {
      vi.spyOn(os, 'networkInterfaces').mockReturnValue({
        eth0: [
          {
            address: '203.0.113.7',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '203.0.113.7/24',
          },
          {
            address: '2a01:4f9:c012:abcd::1',
            netmask: 'ffff:ffff:ffff:ffff::',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '2a01:4f9:c012:abcd::1/64',
            scopeid: 0,
          },
        ],
      });
    }

    it.each([
      'http://203.0.113.7/',
      'http://[::ffff:203.0.113.7]/',
      'http://[::ffff:cb00:7107]/',
      'http://[64:ff9b::cb00:7107]/',
      'http://[2002:cb00:7107::1]/',
      'http://[2a01:04f9:c012:abcd:0:0:0:1]/',
    ])('rejects %s', async (url) => {
      mockInterfaces();
      await expectRejected(url, /^blocked address/);
    });

    it('still allows other public addresses', async () => {
      mockInterfaces();
      await expect(assertSafeUrl('http://8.8.8.8/')).resolves.toBeInstanceOf(URL);
    });
  });

  it('rejects malformed URLs', async () => {
    await expectRejected('not a url', /^invalid URL/);
  });

  it('accepts a public literal IP', async () => {
    const u = await assertSafeUrl('https://8.8.8.8/');
    expect(u.protocol).toBe('https:');
  });
});
