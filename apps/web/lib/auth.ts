import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';
import { rateLimit, clientIp } from '@/lib/infrastructure/rate-limit';

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
      async authorize(credentials, request) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        const normalizedEmail = email.toLowerCase().trim();

        // Online brute-force hesel (a bcrypt DoS): limit pokusů na účet i na IP.
        // Při překročení vracíme stejně jako u špatného hesla null – bez
        // rozlišení, aby limit neprozrazoval existenci účtu.
        const perEmail = rateLimit(`login:email:${normalizedEmail}`, 10, 15 * 60 * 1000);
        const perIp = rateLimit(`login:ip:${clientIp(request)}`, 30, 15 * 60 * 1000);
        if (!perEmail.ok || !perIp.ok) return null;

        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        if (!user.emailVerified) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
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
