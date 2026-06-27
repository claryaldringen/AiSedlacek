import { lookup } from 'node:dns/promises';
import net from 'node:net';

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

/** True if the IP is in a private/loopback/link-local/reserved range. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIP(ip) === 4) return ipv4IsBlocked(ip);

  const s = ip.toLowerCase();
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsBlocked(mapped[1]!);
  if (s === '::1' || s === '::') return true; // loopback / unspecified
  if (/^fe[89ab]/.test(s)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(s)) return true; // unique-local fc00::/7
  if (/^fe[cdef]/.test(s)) return true; // deprecated site-local fec0::/10
  if (s.startsWith('ff')) return true; // multicast ff00::/8
  return false;
}

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
  for (const ip of ips) {
    if (isBlockedAddress(ip)) throw new UnsafeUrlError(`blocked address: ${ip}`);
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
