/**
 * Předání API tokenu pro `ais login` bez tokenu v URL (CLI ≥ 0.3.0).
 *
 * Autorizační stránka vydá krátce platný jednorázový kód svázaný s PKCE
 * výzvou z CLI a přesměruje na loopback jen s kódem. CLI kód vymění za token
 * POSTem, ve kterém pošle ověřovač (`code_verifier`) – ten nikdy neopustí proces
 * CLI, takže kód z historie prohlížeče je bez něj k ničemu a navíc je po
 * použití nebo vypršení neplatný (RFC 8252 + RFC 7636, metoda S256).
 */
import * as crypto from 'node:crypto';
import { prisma } from './db';
import { hashToken } from './api-auth';

/** Platnost autorizačního kódu – CLI ho vyměňuje hned po callbacku. */
export const CLI_CODE_TTL_MS = 5 * 60 * 1000;

/** PKCE: verifier 43–128 znaků z [A-Za-z0-9-._~], challenge = base64url(SHA-256) = 43 znaků. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_RE.test(value);
}

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && VERIFIER_RE.test(value);
}

/** base64url(SHA-256(verifier)) – metoda S256. */
export function codeChallengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Vydá jednorázový kód pro přihlášeného uživatele (uloží se jen jeho hash). */
export async function issueCliAuthCode(userId: string, codeChallenge: string): Promise<string> {
  const now = new Date();
  // Úklid prošlých kódů (tabulka jinak roste s každým přihlášením)
  await prisma.cliAuthCode.deleteMany({ where: { expiresAt: { lt: now } } });
  const code = crypto.randomBytes(32).toString('hex');
  await prisma.cliAuthCode.create({
    data: {
      codeHash: hashToken(code),
      userId,
      codeChallenge,
      expiresAt: new Date(now.getTime() + CLI_CODE_TTL_MS),
    },
  });
  return code;
}

/**
 * Vymění kód za nový API token. Kód musí existovat, nebýt použitý ani prošlý
 * a ověřovač musí odpovídat výzvě. Použití je atomické – druhá výměna téhož
 * kódu (i souběžná) selže.
 *
 * @returns token, nebo null při jakémkoli neúspěchu (bez rozlišení důvodu)
 */
export async function exchangeCliAuthCode(
  code: string,
  codeVerifier: string,
): Promise<string | null> {
  const now = new Date();
  const record = await prisma.cliAuthCode.findUnique({ where: { codeHash: hashToken(code) } });
  if (!record || record.usedAt !== null || record.expiresAt <= now) return null;

  const expected = Buffer.from(record.codeChallenge);
  const actual = Buffer.from(codeChallengeFor(codeVerifier));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.cliAuthCode.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) return null;
    const token = crypto.randomBytes(32).toString('hex');
    await tx.apiToken.create({
      data: { userId: record.userId, tokenHash: hashToken(token), name: 'CLI' },
    });
    return token;
  });
}
