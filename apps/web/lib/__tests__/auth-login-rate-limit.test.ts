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
  });
});
