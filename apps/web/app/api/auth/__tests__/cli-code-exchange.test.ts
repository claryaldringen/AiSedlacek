import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

// `ais login` (CLI ≥ 0.3.0): autorizační stránka vydá jednorázový kód svázaný
// s PKCE výzvou, CLI ho POSTem s ověřovačem vymění za token. Token tak nikdy
// nejde přes URL a kód sám (z historie prohlížeče) je bez ověřovače k ničemu.

interface CodeRow {
  id: string;
  codeHash: string;
  userId: string;
  codeChallenge: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const db = vi.hoisted(() => ({
  codes: [] as CodeRow[],
  tokens: [] as { userId: string; tokenHash: string }[],
  sessionUser: 'user-1' as string | null,
}));

const prismaMock = vi.hoisted(() => {
  const client = {
    cliAuthCode: {
      deleteMany: vi.fn(async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
        const before = db.codes.length;
        db.codes = db.codes.filter((c) => !(c.expiresAt < where.expiresAt.lt));
        return { count: before - db.codes.length };
      }),
      create: vi.fn(async ({ data }: { data: Omit<CodeRow, 'id' | 'usedAt'> }) => {
        const row = { id: `code-${db.codes.length + 1}`, usedAt: null, ...data };
        db.codes.push(row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { codeHash: string } }) =>
          db.codes.find((c) => c.codeHash === where.codeHash) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; usedAt: null; expiresAt: { gt: Date } };
          data: { usedAt: Date };
        }) => {
          const row = db.codes.find(
            (c) => c.id === where.id && c.usedAt === null && c.expiresAt > where.expiresAt.gt,
          );
          if (!row) return { count: 0 };
          row.usedAt = data.usedAt;
          return { count: 1 };
        },
      ),
    },
    apiToken: {
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string } }) => {
        db.tokens.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(client)),
  };
  return client;
});

vi.mock('@/lib/infrastructure/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/infrastructure/auth-utils', async () => {
  const { NextResponse } = await import('next/server');
  return {
    getAuthenticatedUserId: vi.fn(async () =>
      db.sessionUser
        ? { userId: db.sessionUser }
        : { error: NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 }) },
    ),
  };
});

import { POST as issueCode } from '@/app/api/auth/cli/code/route';
import { POST as exchange } from '@/app/api/auth/cli/exchange/route';
import { codeChallengeFor } from '@/lib/infrastructure/cli-auth-code';

// Příklad z RFC 7636, příloha B
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let ipCounter = 0;
function post(path: string, body: unknown, ip?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-locale': 'cs',
      // Každý test z jiné IP, ať se rate limit nesčítá napříč testy
      'x-forwarded-for': ip ?? `10.0.0.${++ipCounter}`,
    },
  });
}

async function issue(): Promise<string> {
  const res = await issueCode(post('/api/auth/cli/code', { codeChallenge: CHALLENGE }));
  expect(res.status).toBe(200);
  const { code } = (await res.json()) as { code: string };
  return code;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.codes = [];
  db.tokens = [];
  db.sessionUser = 'user-1';
});

describe('PKCE (S256)', () => {
  it('výzva odpovídá RFC 7636', () => {
    expect(codeChallengeFor(VERIFIER)).toBe(CHALLENGE);
  });
});

describe('POST /api/auth/cli/code', () => {
  it('vydá jednorázový kód (ne token) a uloží jen jeho hash', async () => {
    const code = await issue();

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(db.tokens).toHaveLength(0);
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0]!.codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(db.codes[0]!.codeHash).not.toBe(code);
    expect(db.codes[0]!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('bez přihlášení 401', async () => {
    db.sessionUser = null;
    const res = await issueCode(post('/api/auth/cli/code', { codeChallenge: CHALLENGE }));
    expect(res.status).toBe(401);
    expect(db.codes).toHaveLength(0);
  });

  it('odmítne výzvu ve špatném tvaru', async () => {
    const res = await issueCode(post('/api/auth/cli/code', { codeChallenge: 'plain-text' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/cli/exchange', () => {
  it('vymění kód s ověřovačem za token uživatele', async () => {
    const code = await issue();

    const res = await exchange(post('/api/auth/cli/exchange', { code, codeVerifier: VERIFIER }));

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.tokens).toEqual([
      {
        userId: 'user-1',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        name: 'CLI',
      },
    ]);
  });

  it('kód jde použít jen jednou', async () => {
    const code = await issue();
    await exchange(post('/api/auth/cli/exchange', { code, codeVerifier: VERIFIER }));

    const again = await exchange(post('/api/auth/cli/exchange', { code, codeVerifier: VERIFIER }));

    expect(again.status).toBe(400);
    expect(db.tokens).toHaveLength(1);
  });

  it('kód z historie prohlížeče bez správného ověřovače nic nedá', async () => {
    const code = await issue();
    const wrongVerifier = 'x'.repeat(43);

    const res = await exchange(
      post('/api/auth/cli/exchange', { code, codeVerifier: wrongVerifier }),
    );

    expect(res.status).toBe(400);
    expect(db.tokens).toHaveLength(0);
    // Kód tím nepropadl – skutečné CLI ho může ještě vyměnit
    expect(db.codes[0]!.usedAt).toBeNull();
  });

  it('prošlý kód neplatí', async () => {
    const code = await issue();
    db.codes[0]!.expiresAt = new Date(Date.now() - 1000);

    const res = await exchange(post('/api/auth/cli/exchange', { code, codeVerifier: VERIFIER }));

    expect(res.status).toBe(400);
    expect(db.tokens).toHaveLength(0);
  });

  it('neplatný tvar vstupu → 400 se stejnou hláškou', async () => {
    const res = await exchange(post('/api/auth/cli/exchange', { code: 'abc', codeVerifier: 'x' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('ais login');
  });

  it('rate limit podle IP', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await exchange(
        post(
          '/api/auth/cli/exchange',
          { code: 'a'.repeat(64), codeVerifier: VERIFIER },
          '10.9.9.9',
        ),
      );
    }
    expect(last!.status).toBe(429);
  });
});
