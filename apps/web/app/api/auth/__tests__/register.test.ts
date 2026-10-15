import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// -- Mocks ---------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

// Registrace po vytvoření účtu posílá ověřovací email (token v DB + mailer).
const mockSendVerificationEmail = vi.fn();

vi.mock('@/lib/infrastructure/verification', () => ({
  sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
}));

// Rate limiter drží stav v paměti modulu napříč testy (limit 10/h na IP) –
// při dalších testech by registrace začala vracet 429.
vi.mock('@/lib/infrastructure/rate-limit', () => ({
  rateLimit: () => ({ ok: true, retryAfterSeconds: 0 }),
  clientIp: () => '127.0.0.1',
}));

const mockHash = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: unknown[]) => mockHash(...args),
  },
}));

// -- Helpers --------------------------------------------------------------

// Hlavička x-locale simuluje český frontend – API podle ní volí jazyk hlášek.
function makeRequest(body?: unknown): NextRequest {
  const init: RequestInit = { method: 'POST', headers: { 'x-locale': 'cs' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', 'x-locale': 'cs' };
  }
  return new NextRequest(new Request('http://localhost/api/auth/register', init));
}

// -- Import route handler (after mocks) -----------------------------------

import { POST } from '@/app/api/auth/register/route';

// -- Tests ----------------------------------------------------------------

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHash.mockResolvedValue('hashed-password-123');
    mockFindUnique.mockResolvedValue(null);
    mockSendVerificationEmail.mockResolvedValue(true);
    mockCreate.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    });
  });

  it('returns 400 when email is missing', async () => {
    const req = makeRequest({ password: 'secret123' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Email a heslo jsou povinné');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when password is missing', async () => {
    const req = makeRequest({ email: 'test@example.com' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Email a heslo jsou povinné');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too short (< 6 chars)', async () => {
    const req = makeRequest({ email: 'test@example.com', password: '12345' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Heslo musí mít alespoň 6 znaků');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when email already exists', async () => {
    // Konflikt je jen u ověřeného účtu (nebo účtu s OAuth) – neověřený
    // credentials účet se při opakované registraci přepíše na místě.
    mockFindUnique.mockResolvedValue({
      id: 'existing-user',
      email: 'test@example.com',
      emailVerified: new Date(),
      accounts: [],
    });

    const req = makeRequest({ email: 'test@example.com', password: 'secret123' });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Uživatel s tímto emailem již existuje');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
      include: { accounts: { select: { id: true } } },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('successfully creates user with hashed password', async () => {
    const req = makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      password: 'secret123',
    });
    const res = await POST(req);

    expect(res.status).toBe(201);

    // Verify bcrypt was called with the raw password and salt rounds
    expect(mockHash).toHaveBeenCalledWith('secret123', 12);

    // Verify user was created with hashed password, not the raw one
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashed-password-123',
      },
    });
  });

  // Od zavedení ověření emailu route nevrací id uživatele, ale email
  // a hlášku o odeslaném ověřovacím emailu.
  it('returns 201 on success with email and verification message', async () => {
    mockCreate.mockResolvedValue({
      id: 'new-user-id',
      email: 'new@example.com',
      name: 'New User',
    });

    const req = makeRequest({
      name: 'New User',
      email: 'new@example.com',
      password: 'validpass',
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.email).toBe('new@example.com');
    expect(json.message).toBe('Ověřovací email odeslán');
    expect(mockSendVerificationEmail).toHaveBeenCalledWith('new@example.com', 'cs');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        body: 'not json{{{',
        headers: { 'Content-Type': 'application/json', 'x-locale': 'cs' },
      }),
    );
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Neplatný JSON');
  });

  it('trims name whitespace and allows null when name is empty', async () => {
    mockCreate.mockResolvedValue({
      id: 'user-2',
      email: 'noname@example.com',
      name: null,
    });

    const req = makeRequest({
      name: '   ',
      email: 'noname@example.com',
      password: 'secret123',
    });
    await POST(req);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: null,
        email: 'noname@example.com',
        password: 'hashed-password-123',
      },
    });
  });
});
