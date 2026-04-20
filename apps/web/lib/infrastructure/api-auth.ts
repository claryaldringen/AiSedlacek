import * as crypto from 'node:crypto';
import { prisma } from '@/lib/infrastructure/db';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function resolveUserFromToken(
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
  });

  if (!apiToken) return null;

  // Update lastUsedAt (fire and forget)
  prisma.apiToken
    .update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return apiToken.userId;
}

export { hashToken };
