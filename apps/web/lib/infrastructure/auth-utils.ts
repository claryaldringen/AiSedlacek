import { requireUserId } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Authenticate the current request and return the userId.
 *
 * Usage:
 * ```ts
 * const auth = await getAuthenticatedUserId();
 * if (auth.error) return auth.error;
 * const { userId } = auth;
 * ```
 */
export async function getAuthenticatedUserId(): Promise<
  { userId: string; error?: never } | { userId?: never; error: NextResponse }
> {
  try {
    const userId = await requireUserId();
    return { userId };
  } catch {
    return { error: NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 }) };
  }
}
