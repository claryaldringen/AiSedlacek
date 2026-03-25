# Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uživatel musí po registraci ověřit email kliknutím na link, než se může přihlásit (pre-login gate).

**Architecture:** Rozšíření stávajícího auth flow o verification token (SHA256 hash v `VerificationToken` modelu), nové API endpointy pro ověření a znovuodeslání, úprava Credentials provideru a login/register stránek. Resend adapter pro odesílání emailů.

**Tech Stack:** Next.js 15 API Routes, NextAuth v5, Prisma, Resend, bcryptjs, crypto

**Spec:** `docs/superpowers/specs/2026-03-25-email-verification-design.md`

---

## File Map

| Action | File | Účel |
|--------|------|------|
| Modify | `packages/shared/src/domain/email.ts` | Přidat `sendVerification` do interface |
| Modify | `packages/shared/src/index.ts` | Ověřit re-export |
| Modify | `apps/web/lib/adapters/email/console-email.ts` | Implementovat `sendVerification` |
| Modify | `apps/web/lib/adapters/email/resend-email.ts` | Implementovat `sendVerification` |
| Create | `apps/web/lib/infrastructure/verification.ts` | Helper: generuj token, pošli email |
| Modify | `apps/web/app/api/auth/register/route.ts` | Email normalizace, re-registrace, verification token |
| Create | `apps/web/app/api/auth/send-verification/route.ts` | Znovuodeslání ověřovacího emailu |
| Create | `apps/web/app/api/auth/verify-email/route.ts` | Ověření tokenu, nastavení emailVerified |
| Create | `apps/web/app/api/auth/check-verification/route.ts` | Kontrola stavu ověření (pro login flow) |
| Modify | `apps/web/lib/auth.ts` | emailVerified check v Credentials |
| Modify | `apps/web/app/login/page.tsx` | Bannery, neověřený email handling, register redirect |
| Create | `apps/web/app/verify-email/page.tsx` | "Zkontrolujte email" stránka |
| Modify | `apps/web/middleware.ts` | Přidat /verify-email do public routes |
| Modify | `apps/web/app/api/auth/forgot-password/route.ts` | Email normalizace |
| Create | `apps/web/prisma/migrations/20260325120000_backfill_email_verified/migration.sql` | Backfill migrace |

---

### Task 1: IEmailProvider — přidat sendVerification

**Files:**
- Modify: `packages/shared/src/domain/email.ts`
- Modify: `apps/web/lib/adapters/email/console-email.ts`
- Modify: `apps/web/lib/adapters/email/resend-email.ts`

- [ ] **Step 1: Přidat sendVerification do interface**

V `packages/shared/src/domain/email.ts`:

```typescript
export interface IEmailProvider {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
  sendVerification(email: string, verifyUrl: string): Promise<void>;
}
```

- [ ] **Step 2: Implementovat v ConsoleEmailProvider**

V `apps/web/lib/adapters/email/console-email.ts`:

```typescript
async sendVerification(email: string, verifyUrl: string): Promise<void> {
  console.log('=== EMAIL VERIFICATION ===');
  console.log(`To: ${email}`);
  console.log(`URL: ${verifyUrl}`);
  console.log('==========================');
}
```

- [ ] **Step 3: Implementovat v ResendEmailProvider**

V `apps/web/lib/adapters/email/resend-email.ts` přidat metodu `sendVerification` s HTML šablonou:

```typescript
async sendVerification(email: string, verifyUrl: string): Promise<void> {
  const { error } = await this.client.emails.send({
    from: this.from,
    to: email,
    subject: 'Ověření emailové adresy',
    html: verificationHtml(verifyUrl),
  });
  if (error) {
    console.error('[ResendEmail] Failed to send verification:', error);
    throw new Error(`Email se nepodařilo odeslat: ${error.message}`);
  }
}
```

HTML šablona (`verificationHtml`): stejný styl jako `passwordResetHtml`, nadpis "Ověření emailu", tlačítko "Ověřit email", poznámka "Odkaz je platný 24 hodin."

- [ ] **Step 4: Typecheck**

Run: `npx turbo typecheck --force`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/domain/email.ts apps/web/lib/adapters/email/
git commit -m "feat: sendVerification metoda v IEmailProvider + Resend/Console adaptéry"
```

---

### Task 2: Verification helper

**Files:**
- Create: `apps/web/lib/infrastructure/verification.ts`

- [ ] **Step 1: Vytvořit helper modul**

`apps/web/lib/infrastructure/verification.ts`:

```typescript
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getEmailProvider } from '@/lib/adapters/email';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const RATE_LIMIT_MS = 60 * 1000; // 60s

/**
 * Generate verification token, store hash in DB, send email.
 * Returns true if sent, false if rate-limited.
 */
export async function sendVerificationEmail(email: string): Promise<boolean> {
  // Rate limit: check if token was sent < 60s ago
  const existing = await prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  });
  if (existing) {
    const createdAt = existing.expires.getTime() - TOKEN_EXPIRY_MS;
    if (Date.now() - createdAt < RATE_LIMIT_MS) {
      return false; // rate-limited
    }
  }

  // Delete old tokens for this email
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });

  // Generate token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: tokenHash,
      expires: new Date(Date.now() + TOKEN_EXPIRY_MS),
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${rawToken}`;

  await getEmailProvider().sendVerification(email, verifyUrl);
  return true;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web --force`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/infrastructure/verification.ts
git commit -m "feat: verification helper — generování tokenu + odeslání emailu"
```

---

### Task 3: Upravit register endpoint

**Files:**
- Modify: `apps/web/app/api/auth/register/route.ts`

- [ ] **Step 1: Přepsat register endpoint**

Nový obsah `apps/web/app/api/auth/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/infrastructure/db';
import { sendVerificationEmail } from '@/lib/infrastructure/verification';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { name, email: rawEmail, password } =
    (body as { name?: string; email?: string; password?: string }) ?? {};

  if (!rawEmail || !password) {
    return NextResponse.json({ error: 'Email a heslo jsou povinné' }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();

  if (password.length < 6) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 6 znaků' }, { status: 400 });
  }

  // Check existing user
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.emailVerified) {
      return NextResponse.json(
        { error: 'Uživatel s tímto emailem již existuje' },
        { status: 409 },
      );
    }
    // Unverified — delete and re-create
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      name: name?.trim() || null,
      email,
      password: hashedPassword,
    },
  });

  try {
    await sendVerificationEmail(email);
  } catch (err) {
    console.error('[register] Failed to send verification email:', err);
    // User is created but email failed — they can use "resend" later
  }

  return NextResponse.json(
    { message: 'Ověřovací email odeslán', email },
    { status: 201 },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web --force`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/auth/register/route.ts
git commit -m "feat: register endpoint — email normalizace, verification token, bez auto-login"
```

---

### Task 4: send-verification endpoint

**Files:**
- Create: `apps/web/app/api/auth/send-verification/route.ts`

- [ ] **Step 1: Vytvořit endpoint**

`apps/web/app/api/auth/send-verification/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';
import { sendVerificationEmail } from '@/lib/infrastructure/verification';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { email: rawEmail } = (body as { email?: string }) ?? {};
  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'Email je povinný' }, { status: 400 });
  }

  const email = rawEmail.toLowerCase().trim();
  const successMessage = 'Pokud existuje neověřený účet, odeslali jsme ověřovací email.';

  // Silent success for non-existent, OAuth-only, or already-verified users
  const user = await prisma.user.findUnique({
    where: { email },
    select: { password: true, emailVerified: true },
  });

  if (!user || !user.password || user.emailVerified) {
    return NextResponse.json({ message: successMessage });
  }

  const sent = await sendVerificationEmail(email);
  if (!sent) {
    // Rate limited — return 200 with rateLimited flag (anti-enumeration: no 429)
    return NextResponse.json({ message: successMessage, rateLimited: true });
  }

  return NextResponse.json({ message: successMessage });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/auth/send-verification/route.ts
git commit -m "feat: send-verification endpoint — znovuodeslání s rate limitem"
```

---

### Task 5: verify-email endpoint

**Files:**
- Create: `apps/web/app/api/auth/verify-email/route.ts`

- [ ] **Step 1: Vytvořit endpoint**

`apps/web/app/api/auth/verify-email/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawToken = request.nextUrl.searchParams.get('token');
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';

  if (!rawToken) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing-token`);
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await prisma.verificationToken.findFirst({
    where: { token: tokenHash },
  });

  if (!record || record.expires < new Date()) {
    // Clean up expired token if found
    if (record) {
      await prisma.verificationToken.delete({
        where: { identifier_token: { identifier: record.identifier, token: record.token } },
      });
    }
    return NextResponse.redirect(`${baseUrl}/login?error=invalid-token`);
  }

  const user = await prisma.user.findUnique({ where: { email: record.identifier } });
  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid-token`);
  }

  // Atomic: set emailVerified + delete token
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token: record.token } },
    }),
  ]);

  return NextResponse.redirect(`${baseUrl}/login?verified=true`);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/auth/verify-email/route.ts
git commit -m "feat: verify-email endpoint — ověření tokenu, atomické nastavení emailVerified"
```

---

### Task 6: check-verification endpoint

**Files:**
- Create: `apps/web/app/api/auth/check-verification/route.ts`

- [ ] **Step 1: Vytvořit endpoint**

`apps/web/app/api/auth/check-verification/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ verified: true }); // fail safe
  }

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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/auth/check-verification/route.ts
git commit -m "feat: check-verification endpoint — kontrola stavu ověření emailu"
```

---

### Task 7: Credentials provider — emailVerified gate

**Files:**
- Modify: `apps/web/lib/auth.ts:30-41`

- [ ] **Step 1: Přidat emailVerified kontrolu**

V `apps/web/lib/auth.ts`, v `authorize` funkci, po řádku `if (!valid) return null;` (řádek 39), přidat:

```typescript
if (!user.emailVerified) return null;
```

Celý blok (řádky 30-41) bude:

```typescript
async authorize(credentials) {
  const email = credentials?.email as string | undefined;
  const password = credentials?.password as string | undefined;
  if (!email || !password) return null;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user?.password) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  if (!user.emailVerified) return null;

  return { id: user.id, name: user.name, email: user.email, image: user.image };
},
```

Poznámka: přidána i email normalizace (`email.toLowerCase().trim()`).

- [ ] **Step 2: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web --force`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/auth.ts
git commit -m "feat: credentials provider — blokování přihlášení bez ověřeného emailu"
```

---

### Task 8: Middleware — přidat /verify-email

**Files:**
- Modify: `apps/web/middleware.ts:4-12`

- [ ] **Step 1: Přidat route**

V `apps/web/middleware.ts`, přidat řádek za `req.nextUrl.pathname.startsWith('/reset-password')`:

```typescript
req.nextUrl.pathname.startsWith('/verify-email') ||
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat: middleware — /verify-email jako public route"
```

---

### Task 9: Verify-email stránka

**Files:**
- Create: `apps/web/app/verify-email/page.tsx`

- [ ] **Step 1: Vytvořit stránku**

`apps/web/app/verify-email/page.tsx`:

```tsx
'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent(): React.JSX.Element {
  const [email, setEmail] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('verify-email');
    if (stored) setEmail(stored);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleResend = async (): Promise<void> => {
    if (!email || sending || countdown > 0) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setMessage('Email byl odeslán nedávno. Zkuste to za chvíli.');
      } else {
        setMessage('Ověřovací email odeslán.');
        setCountdown(60);
      }
    } catch {
      setMessage('Nepodařilo se odeslat email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0e6d0] px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* Mail icon */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#8b1a1a]/10">
          <svg className="h-8 w-8 text-[#8b1a1a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
        </div>

        <h1 className="font-serif text-2xl font-bold text-[#3d2b1f]">
          Zkontrolujte svůj email
        </h1>

        <p className="text-sm text-[#7a6652]">
          {email
            ? <>Na adresu <strong className="text-[#3d2b1f]">{email}</strong> jsme odeslali ověřovací odkaz. Klikněte na něj pro dokončení registrace.</>
            : 'Odeslali jsme vám ověřovací odkaz. Klikněte na něj pro dokončení registrace.'}
        </p>

        {message && (
          <p className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
            {message}
          </p>
        )}

        <button
          onClick={() => void handleResend()}
          disabled={!email || sending || countdown > 0}
          className="rounded-lg border border-[#d4c5a9] bg-[#f5edd6] px-4 py-2.5 font-serif text-sm font-medium text-[#3d2b1f] transition-colors hover:bg-[#ebe0c8] disabled:opacity-50"
        >
          {sending ? 'Odesílám…' : countdown > 0 ? `Odeslat znovu (${countdown}s)` : 'Odeslat znovu'}
        </button>

        <Link
          href="/login"
          className="block text-sm font-medium text-[#8b1a1a] hover:underline"
        >
          Zpět na přihlášení
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/verify-email/page.tsx
git commit -m "feat: /verify-email stránka — zkontrolujte email s resend tlačítkem"
```

---

### Task 10: Login stránka — bannery a neověřený email handling

**Files:**
- Modify: `apps/web/app/login/page.tsx`

- [ ] **Step 1: Přidat verified/error bannery**

V `LoginForm` komponentě, přidat state a efekt pro query params (`verified`, `error`). Přidat banner nad formulář.

- [ ] **Step 2: Upravit registrační flow**

V `handleCredentials`, po úspěšné registraci (mode === 'register', res.ok):

```typescript
if (mode === 'register') {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), email, password }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? 'Registrace selhala');
    setLoading(false);
    return;
  }
  // Redirect to verify-email page
  sessionStorage.setItem('verify-email', email);
  router.push('/verify-email');
  return;
}
```

- [ ] **Step 3: Přidat check-verification po neúspěšném loginu**

Po `signIn` chybě, zavolat `check-verification`:

```typescript
const result = await signIn('credentials', { email, password, redirect: false });
if (result?.error) {
  // Check if email is unverified
  const checkRes = await fetch('/api/auth/check-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const checkData = (await checkRes.json()) as { verified: boolean };
  if (!checkData.verified) {
    setError('EMAIL_NOT_VERIFIED');
  } else {
    setError('Nesprávný email nebo heslo');
  }
  setLoading(false);
  return;
}
```

- [ ] **Step 4: Zobrazit neověřený email UI**

Nahradit stávající error display za:

```tsx
{error === 'EMAIL_NOT_VERIFIED' ? (
  <div className="space-y-2 rounded-lg bg-[#8b1a1a]/10 px-3 py-2">
    <p className="text-sm text-[#8b1a1a]">Email není ověřen.</p>
    <button
      onClick={() => {
        sessionStorage.setItem('verify-email', email);
        router.push('/verify-email');
      }}
      className="text-sm font-semibold text-[#8b1a1a] hover:underline"
    >
      Odeslat ověřovací email znovu
    </button>
  </div>
) : error ? (
  <p className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">{error}</p>
) : null}
```

- [ ] **Step 5: Přidat banner pro verified/error query params**

Nad formulář (po `<p className="mt-1 ...">` bloku) přidat:

```tsx
{searchParams.get('verified') === 'true' && (
  <div className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800">
    Email úspěšně ověřen. Nyní se můžete přihlásit.
  </div>
)}
{searchParams.get('error') === 'invalid-token' && (
  <div className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
    Ověřovací odkaz je neplatný nebo vypršel. Zaregistrujte se znovu nebo si nechte poslat nový.
  </div>
)}
{searchParams.get('error') === 'missing-token' && (
  <div className="rounded-lg bg-[#8b1a1a]/10 px-3 py-2 text-sm text-[#8b1a1a]">
    Chybí ověřovací token. Použijte odkaz z emailu.
  </div>
)}
```

- [ ] **Step 6: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web --force`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/login/page.tsx
git commit -m "feat: login stránka — verified banner, neověřený email handling, register redirect"
```

---

### Task 11: Forgot-password — email normalizace

**Files:**
- Modify: `apps/web/app/api/auth/forgot-password/route.ts`

- [ ] **Step 1: Přidat normalizaci emailu**

V `apps/web/app/api/auth/forgot-password/route.ts`, po řádku `const { email } = ...` (řádek 14), přidat normalizaci. Celý blok:

```typescript
const { email: rawEmail } = (body as { email?: string }) ?? {};

if (!rawEmail || typeof rawEmail !== 'string') {
  return NextResponse.json({ error: 'Email je povinný' }, { status: 400 });
}

const email = rawEmail.toLowerCase().trim();
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/auth/forgot-password/route.ts
git commit -m "fix: forgot-password — normalizace emailu (toLowerCase + trim)"
```

---

### Task 12: Backfill migrace

**Files:**
- Create: `apps/web/prisma/migrations/20260325120000_backfill_email_verified/migration.sql`

- [ ] **Step 1: Vytvořit migraci**

```bash
mkdir -p apps/web/prisma/migrations/20260325120000_backfill_email_verified
```

Soubor `apps/web/prisma/migrations/20260325120000_backfill_email_verified/migration.sql`:

```sql
-- Backfill emailVerified for existing credential users
UPDATE "User"
SET "emailVerified" = NOW()
WHERE "password" IS NOT NULL
  AND "emailVerified" IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/prisma/migrations/20260325120000_backfill_email_verified/
git commit -m "feat: backfill migrace — emailVerified pro existující uživatele s heslem"
```

---

### Task 13: Typecheck + manuální test celého flow

- [ ] **Step 1: Typecheck celého projektu**

Run: `npx turbo typecheck --force`
Expected: 0 errors

- [ ] **Step 2: Lint + format check**

Run: `npx turbo lint && npx turbo format:check`
Expected: 0 errors (opravit pokud se najdou)

- [ ] **Step 3: Manuální test flow**

1. Registrace → ověřit, že se zobrazí /verify-email stránka (ne auto-login)
2. Klik na link v emailu (nebo konzolový log) → ověřit redirect na /login?verified=true
3. Přihlášení → ověřit, že funguje
4. Registrace bez ověření + pokus o login → ověřit "Email není ověřen" hlášku
5. Klik "Odeslat znovu" → ověřit rate limit (60s)
