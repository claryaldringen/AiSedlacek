import { NextRequest, NextResponse } from 'next/server';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { clientIp, rateLimit } from '@/lib/infrastructure/rate-limit';
import { exchangeCliAuthCode, isValidCodeVerifier } from '@/lib/infrastructure/cli-auth-code';

/**
 * POST /api/auth/cli/exchange – CLI (≥ 0.3.0) vymění jednorázový kód z callbacku
 * za API token. Body: { code, codeVerifier }. Veřejný endpoint (CLI ještě nemá
 * token), proto rate limit podle IP; kód je 256bitový a bez ověřovače PKCE
 * nepoužitelný. Jakékoli selhání vrací stejnou odpověď (neprozrazuje důvod).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const rl = rateLimit(`cli-exchange:${clientIp(request)}`, 30, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: t('rateLimited'), retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }
  const { code, codeVerifier } = (body as { code?: unknown; codeVerifier?: unknown }) ?? {};
  if (
    typeof code !== 'string' ||
    !/^[0-9a-f]{64}$/.test(code) ||
    !isValidCodeVerifier(codeVerifier)
  ) {
    return NextResponse.json({ error: t('invalidCliCode') }, { status: 400 });
  }

  const token = await exchangeCliAuthCode(code, codeVerifier);
  if (!token) {
    return NextResponse.json({ error: t('invalidCliCode') }, { status: 400 });
  }
  return NextResponse.json({ token });
}
