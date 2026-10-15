import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import cs from '@/messages/cs.json';

// /api/* je mimo middleware (žádný limit těla od Nextu) – nepřihlášené routy
// musí tělo číst se stropem, jinak anonym gigabajtovým tělem shodí web proces.

// ── Mocks ────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    passwordResetToken: { deleteMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/infrastructure/verification', () => ({ sendVerificationEmail: vi.fn() }));
vi.mock('@/lib/adapters/email', () => ({ getEmailProvider: vi.fn() }));
vi.mock('@/lib/infrastructure/rate-limit', () => ({
  rateLimit: () => ({ ok: true, retryAfterSeconds: 0 }),
  clientIp: () => '127.0.0.1',
}));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }));

const mockConstructEvent = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn(() => ({ webhooks: { constructEvent: mockConstructEvent } })),
}));
vi.mock('@/lib/infrastructure/billing', () => ({
  createTransaction: vi.fn(),
  czkToTokens: vi.fn(),
}));

const mockNextAuthPost = vi.fn();
vi.mock('@/lib/auth', () => ({
  handlers: { GET: vi.fn(), POST: (...args: unknown[]) => mockNextAuthPost(...args) },
}));

import { POST as register } from '@/app/api/auth/register/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { POST as sendVerification } from '@/app/api/auth/send-verification/route';
import { POST as checkVerification } from '@/app/api/auth/check-verification/route';
import { POST as nextAuthPost } from '@/app/api/auth/[...nextauth]/route';
import { POST as stripeWebhook } from '@/app/api/billing/webhook/route';

// ── Helpers ──────────────────────────────────────────────

const HUGE_JSON = JSON.stringify({ email: 'a@b.cz', password: 'x'.repeat(200 * 1024) });

function jsonRequest(
  path: string,
  body: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-locale': 'cs', ...headers },
  });
}

/** Tělo jako stream bez Content-Length (chunked) – limit musí platit i tak. */
function streamingRequest(
  path: string,
  totalBytes: number,
  headers: Record<string, string> = {},
): { request: NextRequest; sent: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      controller.enqueue(new Uint8Array(64 * 1024).fill(0x61));
      sent += 64 * 1024;
    },
  });
  const request = new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: stream,
    headers: { 'content-type': 'application/json', 'x-locale': 'cs', ...headers },
    duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1]);
  return { request, sent: () => sent };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────

describe('unauthenticated auth routes – body size limit', () => {
  it.each([
    ['register', register, '/api/auth/register'],
    ['forgot-password', forgotPassword, '/api/auth/forgot-password'],
    ['reset-password', resetPassword, '/api/auth/reset-password'],
    ['send-verification', sendVerification, '/api/auth/send-verification'],
    ['check-verification', checkVerification, '/api/auth/check-verification'],
  ] as const)('%s rejects an oversized JSON body with 413', async (_name, handler, path) => {
    const res = await handler(jsonRequest(path, HUGE_JSON));

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(cs.api.requestTooLarge);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('register stops reading a chunked body without Content-Length', async () => {
    const { request, sent } = streamingRequest('/api/auth/register', 50 * 1024 * 1024);
    expect(request.headers.get('content-length')).toBeNull();

    const res = await register(request);

    expect(res.status).toBe(413);
    expect(sent()).toBeLessThan(50 * 1024 * 1024);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('register still reports invalid JSON as 400', async () => {
    const res = await register(jsonRequest('/api/auth/register', '{nope'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(cs.api.invalidJson);
  });

  it('check-verification keeps its fail-safe answer for invalid JSON', async () => {
    const res = await checkVerification(jsonRequest('/api/auth/check-verification', '{nope'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true });
  });
});

describe('POST /api/auth/[...nextauth] – body size limit', () => {
  it('rejects an oversized body before NextAuth reads it', async () => {
    const { request, sent } = streamingRequest('/api/auth/callback/credentials', 10 * 1024 * 1024, {
      'content-type': 'application/x-www-form-urlencoded',
    });

    const res = await nextAuthPost(request);

    expect(res.status).toBe(413);
    expect(mockNextAuthPost).not.toHaveBeenCalled();
    expect(sent()).toBeLessThan(10 * 1024 * 1024);
  });

  it('passes a normal sign-in request (body, headers, URL) through to NextAuth', async () => {
    mockNextAuthPost.mockResolvedValue(new Response(null, { status: 302 }));
    const form = 'email=a%40b.cz&password=secret&csrfToken=abc';
    const req = new NextRequest('http://localhost/api/auth/callback/credentials?json=true', {
      method: 'POST',
      body: form,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: 'authjs.csrf-token=abc',
      },
    });

    const res = await nextAuthPost(req);

    expect(res.status).toBe(302);
    const forwarded = mockNextAuthPost.mock.calls[0]![0] as NextRequest;
    expect(forwarded.url).toBe('http://localhost/api/auth/callback/credentials?json=true');
    expect(forwarded.cookies.get('authjs.csrf-token')?.value).toBe('abc');
    expect(await forwarded.text()).toBe(form);
  });
});

describe('POST /api/billing/webhook – body size limit', () => {
  it('rejects an oversized payload with 413 before verifying the signature', async () => {
    const { request, sent } = streamingRequest('/api/billing/webhook', 5 * 1024 * 1024, {
      'stripe-signature': 't=1,v1=abc',
    });

    const res = await stripeWebhook(request);

    expect(res.status).toBe(413);
    expect(mockConstructEvent).not.toHaveBeenCalled();
    expect(sent()).toBeLessThan(5 * 1024 * 1024);
  });

  it('verifies the signature over the exact raw body', async () => {
    const raw = '{"id":"evt_1","type":"customer.created"}';
    mockConstructEvent.mockReturnValue({ type: 'customer.created', data: { object: {} } });

    const res = await stripeWebhook(
      jsonRequest('/api/billing/webhook', raw, { 'stripe-signature': 't=1,v1=abc' }),
    );

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledWith(raw, 't=1,v1=abc', undefined);
  });
});
