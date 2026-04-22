import { requireUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { resolveUserFromToken } from './api-auth';

type AuthResult = { userId: string; error?: never } | { userId?: never; error: NextResponse };

/**
 * Authenticate the current request and return the userId.
 * Session-only — use resolveUserId(request) for endpoints that also accept Bearer tokens.
 *
 * Usage:
 * ```ts
 * const auth = await getAuthenticatedUserId();
 * if (auth.error) return auth.error;
 * const { userId } = auth;
 * ```
 */
export async function getAuthenticatedUserId(locale = 'en'): Promise<AuthResult> {
  try {
    const userId = await requireUserId();
    return { userId };
  } catch {
    const t = await getTranslations({ locale, namespace: 'api' });
    return { error: NextResponse.json({ error: t('notLoggedIn') }, { status: 401 }) };
  }
}

/**
 * Authenticate via Bearer token first, then fall back to session.
 * Use this for endpoints that should be accessible from both CLI and web.
 */
export async function resolveUserId(request: NextRequest, locale = 'en'): Promise<AuthResult> {
  const userId = await resolveUserFromToken(request.headers.get('authorization'));
  if (userId) return { userId };
  return getAuthenticatedUserId(locale);
}
