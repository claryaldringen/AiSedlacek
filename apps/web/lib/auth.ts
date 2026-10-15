import { createHash } from 'node:crypto';
import NextAuth, { CredentialsSignin } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';
import {
  rateLimit,
  peekRateLimit,
  resetRateLimit,
  clientIp,
} from '@/lib/infrastructure/rate-limit';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Neúspěšné pokusy z jedné IP (online brute-force hesel napříč účty). */
const LOGIN_MAX_FAILURES_PER_IP = 30;
/** Neúspěšné pokusy na jeden účet (brute-force hesla konkrétního účtu). */
const LOGIN_MAX_FAILURES_PER_ACCOUNT = 10;
/**
 * Všechny pokusy z jedné IP (i úspěšné) – jen pojistka proti bcrypt DoS
 * s platným heslem; štědrá, aby nezablokovala sdílenou IP (NAT knihovny).
 */
const LOGIN_MAX_ATTEMPTS_PER_IP = 200;

/**
 * Překročený limit přihlášení. NextAuth předá `code` klientovi (signIn vrací
 * `{ error: 'CredentialsSignin', code: 'rate_limited' }`), takže login stránka
 * ukáže „zkuste to za chvíli" místo „špatné heslo".
 */
export class LoginRateLimitedError extends CredentialsSignin {
  override code = 'rate_limited';
}

/**
 * Ověření e-mailu a hesla s limitem pokusů. Počítají se jen neúspěšné pokusy
 * (úspěch vynuluje počítadlo účtu) – jinak by útočník znalý e-mailu oběť
 * zablokoval a sdílená IP by zablokovala všechny za ní. Neúspěch se počítá
 * stejně pro existující i neexistující účet, limit tak neprozrazuje existenci účtu.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
  request: Request,
): Promise<{ id: string; name: string | null; email: string | null; image: string | null } | null> {
  const email = credentials?.['email'];
  const password = credentials?.['password'];
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return null;
  }
  const normalizedEmail = email.toLowerCase().trim();
  // E-mail má max. 254 znaků; bcrypt stejně čte jen prvních 72 bajtů hesla.
  if (normalizedEmail.length > 254 || password.length > 1024) return null;

  const ip = clientIp(request);
  const ipFailuresKey = `login:ip:${ip}`;
  // Klíč účtu je hash (pevná délka, e-mail volí klient).
  const emailKey = createHash('sha256').update(normalizedEmail).digest('base64url');
  const accountFailuresKey = `login:email:${emailKey}`;

  // Limity neúspěchů napřed jen čteme (bez bcryptu a bez nových bucketů pro
  // účet) – po vyčerpání IP limitu tak rotace e-mailů z jedné IP nezvětšuje
  // mapu limiteru. Neúspěch se započte až po ověření hesla níže.
  if (
    !rateLimit(`login:attempts:${ip}`, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS).ok ||
    !peekRateLimit(ipFailuresKey, LOGIN_MAX_FAILURES_PER_IP).ok ||
    !peekRateLimit(accountFailuresKey, LOGIN_MAX_FAILURES_PER_ACCOUNT).ok
  ) {
    throw new LoginRateLimitedError();
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const valid = user?.password ? await bcrypt.compare(password, user.password) : false;
  if (!user || !valid) {
    rateLimit(ipFailuresKey, LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS);
    rateLimit(accountFailuresKey, LOGIN_MAX_FAILURES_PER_ACCOUNT, LOGIN_WINDOW_MS);
    return null;
  }
  resetRateLimit(accountFailuresKey);

  if (!user.emailVerified) return null;

  return { id: user.id, name: user.name, email: user.email, image: user.image };
}

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: '/login',
  },
  providers: [
    Google({
      clientId: process.env['GOOGLE_CLIENT_ID'],
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env['GITHUB_CLIENT_ID'],
      clientSecret: process.env['GITHUB_CLIENT_SECRET'],
    }),
    Credentials({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Heslo', type: 'password' },
      },
      authorize: (credentials, request) => authorizeCredentials(credentials, request),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export const handlers: any = nextAuth.handlers;
export const signIn: any = nextAuth.signIn;
export const signOut: any = nextAuth.signOut;
export const auth: any = nextAuth.auth;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Get the current user ID from the session, or null if not authenticated.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Get the current user ID, throwing 401 if not authenticated.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('UNAUTHORIZED');
  }
  return userId;
}
