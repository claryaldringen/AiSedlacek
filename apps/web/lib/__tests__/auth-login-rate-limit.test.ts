import { describe, it, expect, vi, beforeEach } from 'vitest';

// Limit přihlášení počítá jen neúspěšné pokusy: útočník znalý e-mailu nesmí
// oběť zablokovat jejím vlastním úspěšným přihlášením a sdílená IP (NAT
// knihovny) se nesmí zablokovat běžným provozem. Překročení je rozlišitelná
// chyba (`code: 'rate_limited'`), ne „špatné heslo".

// ── Mocks ────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) } },
}));

const mockCompare = vi.fn();
vi.mock('bcryptjs', () => ({
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  return {
    default: vi.fn(() => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() })),
    CredentialsSignin,
  };
});
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: vi.fn() }));
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn() }));

const loadModule = () => import('@/lib/auth');
let authorizeCredentials: Awaited<ReturnType<typeof loadModule>>['authorizeCredentials'];
let LoginRateLimitedError: Awaited<ReturnType<typeof loadModule>>['LoginRateLimitedError'];

// ── Helpers ──────────────────────────────────────────────

const USER = {
  id: 'user-1',
  name: 'Uživatel',
  email: 'victim@example.com',
  image: null,
  password: 'bcrypt-hash',
  emailVerified: new Date('2026-01-01'),
};

function request(ip = '10.0.0.1'): Request {
  return new Request('http://localhost/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

function login(password: string, ip?: string, email = USER.email) {
  return authorizeCredentials({ email, password }, request(ip));
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Čerstvý modul = prázdná mapa limiteru; testy nesdílí stav.
  vi.resetModules();
  ({ authorizeCredentials, LoginRateLimitedError } = await loadModule());
  mockUserFindUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
    where.email === USER.email ? USER : null,
  );
  mockCompare.mockImplementation(async (password: string) => password === 'correct');
});

// ── Tests ────────────────────────────────────────────────

describe('authorizeCredentials – login rate limit', () => {
  it('returns the user for valid credentials', async () => {
    expect(await login('correct')).toEqual({
      id: 'user-1',
      name: 'Uživatel',
      email: 'victim@example.com',
      image: null,
    });
  });

  it('does not count successful logins towards the limit', async () => {
    for (let i = 0; i < 30; i++) expect(await login('correct')).not.toBeNull();
  });

  it('blocks the account after 10 failures with a distinguishable rate_limited error', async () => {
    for (let i = 0; i < 10; i++) expect(await login('wrong', `10.0.1.${i}`)).toBeNull();

    const attempt = login('correct', '10.0.2.1');
    await expect(attempt).rejects.toBeInstanceOf(LoginRateLimitedError);
    await expect(attempt).rejects.toMatchObject({ code: 'rate_limited' });
    // Při překročení se heslo vůbec neověřuje (bcrypt DoS).
    expect(mockCompare).toHaveBeenCalledTimes(10);
  });

  it('a successful login resets the account failure counter', async () => {
    for (let i = 0; i < 9; i++) await login('wrong');
    expect(await login('correct')).not.toBeNull();

    // Po vynulování má účet zase plný počet pokusů.
    for (let i = 0; i < 9; i++) expect(await login('wrong')).toBeNull();
    expect(await login('correct')).not.toBeNull();
  });

  it('blocks an IP after 30 failures across different accounts', async () => {
    for (let i = 0; i < 30; i++) {
      expect(await login('wrong', '10.0.0.9', `user${i}@example.com`)).toBeNull();
    }

    await expect(login('correct', '10.0.0.9')).rejects.toBeInstanceOf(LoginRateLimitedError);
    // Jiná IP se k účtu dál přihlásí.
    expect(await login('correct', '10.0.0.10')).not.toBeNull();
  });

  it('counts failures for non-existent accounts too (no account enumeration)', async () => {
    const ghost = 'ghost@example.com';
    for (let i = 0; i < 10; i++) expect(await login('wrong', `10.0.3.${i}`, ghost)).toBeNull();

    await expect(login('wrong', '10.0.4.1', ghost)).rejects.toBeInstanceOf(LoginRateLimitedError);
  });

  it('caps all attempts per IP as a bcrypt DoS backstop', async () => {
    for (let i = 0; i < 200; i++) expect(await login('correct', '10.0.0.5')).not.toBeNull();

    await expect(login('correct', '10.0.0.5')).rejects.toBeInstanceOf(LoginRateLimitedError);
  });

  it('rejects an unverified e-mail without counting it as a failed password', async () => {
    mockUserFindUnique.mockResolvedValue({ ...USER, emailVerified: null });

    for (let i = 0; i < 15; i++) expect(await login('correct')).toBeNull();
    // Ani IP se správným heslem neblíží limitu neúspěchů.
    for (let i = 0; i < 30; i++) expect(await login('wrong', '10.0.0.1', `x${i}@e.cz`)).toBeNull();
  });

  it('successful logins from an IP do not consume its failure budget', async () => {
    const ip = '10.0.0.7';
    for (let i = 0; i < 29; i++)
      expect(await login('wrong', ip, `user${i}@example.com`)).toBeNull();
    for (let i = 0; i < 20; i++) expect(await login('correct', ip)).not.toBeNull();

    // Třicátý neúspěch je pořád povolený, teprve pak se IP zablokuje.
    expect(await login('wrong', ip, 'user29@example.com')).toBeNull();
    await expect(login('correct', ip)).rejects.toBeInstanceOf(LoginRateLimitedError);
  });

  it('concurrent attempts cannot bypass the account limit', async () => {
    // Pomalý bcrypt: všechny requesty dorazí dřív, než první ověření skončí.
    mockCompare.mockImplementation(
      (password: string) =>
        new Promise((resolve) => setTimeout(() => resolve(password === 'correct'), 20)),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => login('wrong', `10.0.5.${i % 3}`)),
    );

    expect(mockCompare).toHaveBeenCalledTimes(10);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(40);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(LoginRateLimitedError);
  });

  it('concurrent attempts from one IP cannot bypass the IP limit', async () => {
    mockUserFindUnique.mockResolvedValue(USER); // každý e-mail existuje → bcrypt
    mockCompare.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    );

    await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) => login('wrong', '10.0.6.1', `u${i % 20}@example.com`)),
    );

    // 20 účtů × 5 pokusů – limit účtu (10) nezasáhne, strop dává IP limit 30.
    expect(mockCompare).toHaveBeenCalledTimes(30);
  });

  it('a database error is not counted as a failed password', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    for (let i = 0; i < 15; i++) await expect(login('correct')).rejects.toThrow('db down');

    mockUserFindUnique.mockResolvedValue(USER);
    expect(await login('correct')).not.toBeNull();
  });
});
