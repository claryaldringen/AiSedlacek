import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { readJsonBody } from '@/lib/infrastructure/read-body';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Nepřihlášená routa – tělo jen se stropem velikosti (viz read-body.ts).
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    if (parsed.error === 'invalid') return NextResponse.json({ verified: true }); // fail safe
    const t = await getApiTranslations(request, 'api');
    return NextResponse.json({ error: t('requestTooLarge') }, { status: 413 });
  }
  const body = parsed.value;

  const { email: rawEmail } = (body as { email?: string }) ?? {};
  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ verified: true }); // fail safe
  }

  const email = rawEmail.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true },
  });

  // Non-existent user → true (prevent enumeration)
  if (!user) {
    return NextResponse.json({ verified: true });
  }

  return NextResponse.json({ verified: user.emailVerified !== null });
}
