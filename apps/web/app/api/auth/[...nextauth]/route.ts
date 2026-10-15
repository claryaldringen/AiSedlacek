import { NextRequest, NextResponse } from 'next/server';
import { handlers } from '@/lib/auth';
import { MAX_JSON_BODY_BYTES, readBodyLimited } from '@/lib/infrastructure/read-body';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export const { GET } = handlers;

/**
 * NextAuth čte tělo (přihlášení, odhlášení, CSRF) bez limitu a routa je
 * nepřihlášená – tělo proto načteme se stropem a NextAuthu předáme kopii
 * requestu s už načteným tělem.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: Uint8Array | null;
  try {
    body = await readBodyLimited(request, MAX_JSON_BODY_BYTES);
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (body === null) {
    const t = await getApiTranslations(request, 'api');
    return NextResponse.json({ error: t('requestTooLarge') }, { status: 413 });
  }
  return handlers.POST(new NextRequest(request, { body: body as BodyInit }));
}
