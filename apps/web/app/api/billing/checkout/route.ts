import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

export async function POST(request: Request): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: t('unauthorized') }, { status: 401 });
  }

  const { amountCzk } = (await request.json()) as { amountCzk: number };

  if (!amountCzk || amountCzk < 100 || amountCzk > 10000) {
    return NextResponse.json({ error: t('invalidPaymentAmount') }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: t('paymentNotConfigured') }, { status: 503 });
  }

  const baseUrl = (process.env.NEXTAUTH_URL ?? 'http://localhost:3003').trim();

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'czk',
            product_data: { name: `Dobití ${amountCzk} Kč tokenů` },
            unit_amount: amountCzk * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: session.user.email ?? undefined,
      locale: 'cs',
      metadata: { userId: session.user.id },
      success_url: `${baseUrl}/workspace/billing?success=true`,
      cancel_url: `${baseUrl}/workspace/billing?cancelled=true`,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    const message = e instanceof Error ? e.message : t('serverError');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
