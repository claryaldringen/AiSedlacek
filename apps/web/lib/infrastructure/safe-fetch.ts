import { lookup } from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';

/**
 * SSRF defenses for endpoints that fetch attacker-supplied URLs (URL import,
 * context fetching, page discovery). Without these guards a caller could make
 * the server request internal services, cloud metadata (169.254.169.254),
 * loopback, or link-local addresses.
 *
 * Strategy: allow only http/https, resolve the hostname to its IP(s) and reject
 * any private/loopback/link-local/metadata range, and follow redirects manually
 * so each hop is re-validated (a public host cannot 302 to an internal one).
 * Residual risk: DNS rebinding between validation and connect — acceptable for
 * this tool; full mitigation would require pinning the resolved IP at the socket.
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4IsBlocked(ip: string): boolean {
  const octets = ip.split('.').map((n) => Number(n));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast (224/4), reserved (240/4), broadcast
  return false;
}

/**
 * Parse an IPv6 address into its 8 16-bit groups. Handles `::` compression,
 * a dotted IPv4 tail (`::ffff:1.2.3.4`) and a zone id (`fe80::1%eth0`).
 * Returns null for malformed input.
 */
function parseIPv6(ip: string): number[] | null {
  const s = ip.toLowerCase().replace(/%.*$/, '');
  if (net.isIP(s) !== 6) return null;

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const token of part.split(':')) {
      if (token.includes('.')) {
        if (net.isIP(token) !== 4) return null;
        const [a, b, c, d] = token.split('.').map(Number) as [number, number, number, number];
        groups.push((a << 8) | b, (c << 8) | d);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        groups.push(parseInt(token, 16));
      }
    }
    return groups;
  };
  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function ipv4FromGroups(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function ipv6IsBlocked(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true; // malformed → treat as unsafe

  // Embedded IPv4 musí projít IPv4 pravidly – jinak lze blocklist obejít zápisem
  // `::ffff:a9fe:a9fe`, na který WHATWG URL normalizuje `[::ffff:169.254.169.254]`.
  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  if (firstFiveZero && g[5] === 0xffff) return ipv4IsBlocked(ipv4FromGroups(g[6]!, g[7]!)); // ::ffff:0:0/96 mapped
  if (firstFiveZero && g[5] === 0) {
    // ::/96 – unspecified, loopback a zastaralé IPv4-compatible adresy
    return g[6] === 0 ? true : ipv4IsBlocked(ipv4FromGroups(g[6]!, g[7]!));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return ipv4IsBlocked(ipv4FromGroups(g[6]!, g[7]!)); // NAT64 64:ff9b::/96
  }
  if (g[0] === 0x2002) return ipv4IsBlocked(ipv4FromGroups(g[1]!, g[2]!)); // 6to4 2002::/16
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation 2001:db8::/32

  const first = g[0]!;
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}

/** True if the IP is in a private/loopback/link-local/reserved range. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIP(ip) === 4) return ipv4IsBlocked(ip);
  return ipv6IsBlocked(ip);
}

/**
 * Adresy vlastních síťových rozhraní (včetně veřejné IP VPS). Request na vlastní
 * veřejnou IP jde přes loopback, kde firewall neplatí – bez této kontroly by šlo
 * přes import z URL dosáhnout na služby ostatních aplikací na sdíleném serveru.
 */
function localInterfaceAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      addresses.add(entry.address.toLowerCase().replace(/%.*$/, ''));
    }
  }
  return addresses;
}

// Uživatelské URL (IIIF servery, digitální knihovny) běží na standardních portech;
// ostatní porty blokujeme, aby šlo hůř sondovat interní služby.
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/**
 * Validate a URL is safe to fetch server-side. Throws UnsafeUrlError otherwise.
 * Returns the parsed URL on success.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UnsafeUrlError('only http/https is allowed');
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw new UnsafeUrlError(`port not allowed: ${u.port}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    let resolved: { address: string }[];
    try {
      resolved = await lookup(host, { all: true });
    } catch {
      throw new UnsafeUrlError('cannot resolve host');
    }
    ips = resolved.map((r) => r.address);
    if (ips.length === 0) throw new UnsafeUrlError('cannot resolve host');
  }
  const local = localInterfaceAddresses();
  for (const ip of ips) {
    if (isBlockedAddress(ip) || local.has(ip.toLowerCase())) {
      throw new UnsafeUrlError(`blocked address: ${ip}`);
    }
  }
  return u;
}

/**
 * fetch() with SSRF protection and manual redirect re-validation.
 * Each redirect target is re-checked, so an allowed host cannot bounce to an
 * internal one. Throws UnsafeUrlError on an unsafe URL or too many redirects.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 4;
  let current = (await assertSafeUrl(rawUrl)).toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      current = (await assertSafeUrl(next.toString())).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError('too many redirects');
}

/**
 * Read a Response body into a Buffer, aborting if it exceeds maxBytes.
 * Checks Content-Length first, then enforces the cap while streaming so an
 * unbounded/oversized body cannot exhaust memory before the size check.
 */
export async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = res.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new UnsafeUrlError('response too large');
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new UnsafeUrlError('response too large');
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError('response too large');
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}
