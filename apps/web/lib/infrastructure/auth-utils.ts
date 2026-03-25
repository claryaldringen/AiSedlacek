import { requireUserId } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';

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
export async function getAuthenticatedUserId(
  locale = 'en',
): Promise<{ userId: string; error?: never } | { userId?: never; error: NextResponse }> {
  try {
    const userId = await requireUserId();
    return { userId };
  } catch {
    const t = await getTranslations({ locale, namespace: 'api' });
    return { error: NextResponse.json({ error: t('notLoggedIn') }, { status: 401 }) };
  }
}
