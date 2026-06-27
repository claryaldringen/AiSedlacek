import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createTransaction, czkToTokens } from '@/lib/infrastructure/billing';

export async function POST(request: Request): Promise<NextResponse> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const amountTotal = session.amount_total; // in halire

    if (typeof userId !== 'string' || userId.length === 0) {
      console.error('[stripe-webhook] Invalid or missing userId in session metadata', {
        sessionId: session.id,
        userId,
      });
      return NextResponse.json({ received: true });
    }

    if (typeof amountTotal !== 'number' || amountTotal <= 0) {
      console.error('[stripe-webhook] Invalid or missing amountTotal in session', {
        sessionId: session.id,
        amountTotal,
      });
      return NextResponse.json({ received: true });
    }

    // czkToTokens assumes CZK halíře — refuse to credit other currencies.
    if (session.currency && session.currency.toLowerCase() !== 'czk') {
      console.error('[stripe-webhook] Unexpected currency', {
        sessionId: session.id,
        currency: session.currency,
      });
      return NextResponse.json({ received: true });
    }

    // Only credit fully-paid sessions.
    if (session.payment_status && session.payment_status !== 'paid') {
      return NextResponse.json({ received: true });
    }

    const tokens = czkToTokens(amountTotal);

    await createTransaction({
      userId,
      type: 'topup_stripe',
      amount: tokens,
      amountCzk: amountTotal,
      description: `Dobití kartou: ${(amountTotal / 100).toFixed(0)} Kč`,
      // Use the checkout session id as the idempotency key — it is always present
      // and stable across webhook retries (payment_intent can be null), so a
      // redelivered event won't double-credit.
      referenceId: session.id,
    });
  }

  return NextResponse.json({ received: true });
}
