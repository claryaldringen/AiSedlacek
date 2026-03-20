import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// -- Mocks ---------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

const mockHash = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: unknown[]) => mockHash(...args),
  },
}));

// -- Helpers --------------------------------------------------------------

function makeRequest(body?: unknown): NextRequest {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
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
    mockFindUnique.mockResolvedValue({ id: 'existing-user', email: 'test@example.com' });

    const req = makeRequest({ email: 'test@example.com', password: 'secret123' });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Uživatel s tímto emailem již existuje');
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
    expect(mockCreate).not.toHaveBeenCalled();
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

  it('returns 201 on success with user id and email', async () => {
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
    expect(json.id).toBe('new-user-id');
    expect(json.email).toBe('new@example.com');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        body: 'not json{{{',
        headers: { 'Content-Type': 'application/json' },
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
