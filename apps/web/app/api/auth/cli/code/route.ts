import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { isValidCodeChallenge, issueCliAuthCode } from '@/lib/infrastructure/cli-auth-code';

/**
 * POST /api/auth/cli/code – autorizační stránka `ais login` (CLI ≥ 0.3.0) vydá
 * pro přihlášeného uživatele jednorázový kód svázaný s PKCE výzvou z CLI.
 * Body: { codeChallenge } (base64url SHA-256 ověřovače, metoda S256).
 * Token se vydá až výměnou kódu v POST /api/auth/cli/exchange.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const t = await getApiTranslations(request, 'api');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }
  const { codeChallenge } = (body as { codeChallenge?: unknown }) ?? {};
  if (!isValidCodeChallenge(codeChallenge)) {
    return NextResponse.json({ error: t('invalidBody') }, { status: 400 });
  }

  const code = await issueCliAuthCode(userId, codeChallenge);
  return NextResponse.json({ code });
}
