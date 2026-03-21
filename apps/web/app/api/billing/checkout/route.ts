import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  const { amountCzk } = (await request.json()) as { amountCzk: number };

  if (!amountCzk || amountCzk < 100 || amountCzk > 10000) {
    return NextResponse.json({ error: 'Neplatná částka (100–10 000 Kč)' }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Platba kartou není nakonfigurována' }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'czk',
        product_data: { name: `Dobití ${amountCzk} Kč tokenů` },
        unit_amount: amountCzk * 100,
      },
      quantity: 1,
    }],
    mode: 'payment',
    customer_email: session.user.email ?? undefined,
    locale: 'cs',
    metadata: { userId: session.user.id },
    success_url: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3003'}/workspace/billing?success=true`,
    cancel_url: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3003'}/workspace/billing?cancelled=true`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
