import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getEmailProvider } from '@/lib/adapters/email';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const RATE_LIMIT_MS = 60 * 1000; // 60s

/**
 * Generate verification token, store hash in DB, send email.
 * Returns true if sent, false if rate-limited.
 */
export async function sendVerificationEmail(email: string): Promise<boolean> {
  // Rate limit: check if token was sent < 60s ago
  const existing = await prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  });
  if (existing) {
    const createdAt = existing.expires.getTime() - TOKEN_EXPIRY_MS;
    if (Date.now() - createdAt < RATE_LIMIT_MS) {
      return false; // rate-limited
    }
  }

  // Delete old tokens for this email
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });

  // Generate token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: tokenHash,
      expires: new Date(Date.now() + TOKEN_EXPIRY_MS),
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${rawToken}`;

  await getEmailProvider().sendVerification(email, verifyUrl);
  return true;
}
