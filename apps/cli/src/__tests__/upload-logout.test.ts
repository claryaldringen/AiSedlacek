import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Příkazy upload a logout: chyby API se nesmí tiše spolknout (exit kód, výpis).

const api = vi.hoisted(() => ({
  get: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  delete: vi.fn(),
  postFormData: vi.fn(),
  getRaw: vi.fn(),
}));
const auth = vi.hoisted(() => ({ getToken: vi.fn(), deleteToken: vi.fn() }));

vi.mock('../lib/require-auth.js', () => ({
  requireAuth: () => ({ token: 'test-token', api }),
}));
vi.mock('../lib/auth.js', () => auth);
vi.mock('../lib/config.js', () => ({ loadConfig: () => ({ server: 'https://ais.test' }) }));
vi.mock('ora', () => ({
  default: () => {
    const spinner = { text: '', start: () => spinner, stop: () => spinner };
    return spinner;
  },
}));

const { uploadCommand } = await import('../commands/upload.js');
const { logoutCommand } = await import('../commands/logout.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

let tmpDir: string;
let errors: string[];
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-cli-test-'));
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    errors.push(String(msg));
  });
  vi.stubGlobal('fetch', mockFetch);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('ais upload', () => {
  it('sends a local file with the MIME type detected from its content', async () => {
    const file = path.join(tmpDir, 'scan.jpg'); // zavádějící přípona, obsah je PNG
    fs.writeFileSync(file, PNG);
    api.postFormData.mockResolvedValue({ pages: [{ id: 'p1', filename: 'scan.jpg' }], errors: [] });

    await uploadCommand.parseAsync([file], { from: 'user' });

    expect(api.postFormData).toHaveBeenCalledTimes(1);
    const formData = api.postFormData.mock.calls[0]![1] as FormData;
    const sent = formData.get('files') as File;
    expect(sent.type).toBe('image/png');
    expect(sent.name).toBe('scan.jpg');
    expect(process.exitCode).toBeUndefined();
  });

  it('sends URLs to the server in batches of 50', async () => {
    const urls = Array.from({ length: 120 }, (_, i) => `https://example.org/${i}.png`);
    api.postJson.mockImplementation((_path: string, body: { urls: string[] }) =>
      Promise.resolve({
        pages: body.urls.map((u, i) => ({ id: `p-${u}`, filename: `${i}.png` })),
        errors: [],
      }),
    );

    await uploadCommand.parseAsync(urls, { from: 'user' });

    const sizes = api.postJson.mock.calls.map((c) => (c[1] as { urls: string[] }).urls.length);
    expect(sizes).toEqual([50, 50, 20]);
    expect(api.postJson.mock.calls.flatMap((c) => (c[1] as { urls: string[] }).urls)).toEqual(urls);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not send unsupported files and exits with an error', async () => {
    const file = path.join(tmpDir, 'image.svg');
    fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');

    await uploadCommand.parseAsync([file], { from: 'user' });

    expect(api.postFormData).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('nepodporovaný formát');
  });

  it('does not trust the extension when the content is not an image', async () => {
    const file = path.join(tmpDir, 'photo.jpg'); // např. HEIC nebo poškozený soubor
    fs.writeFileSync(file, Buffer.from('not really a jpeg'));

    await uploadCommand.parseAsync([file], { from: 'user' });

    expect(api.postFormData).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits with an error when the server rejects a file', async () => {
    const file = path.join(tmpDir, 'scan.png');
    fs.writeFileSync(file, PNG);
    api.postFormData.mockResolvedValue({
      pages: [],
      errors: [{ filename: 'scan.png', error: 'Unsupported format' }],
    });

    await uploadCommand.parseAsync([file], { from: 'user' });

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unsupported format');
  });

  it('exits with an error when a source file does not exist', async () => {
    await uploadCommand.parseAsync([path.join(tmpDir, 'missing.png')], { from: 'user' });

    expect(api.postFormData).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe('ais logout', () => {
  beforeEach(() => {
    auth.getToken.mockReturnValue('test-token');
  });

  it('revokes the token and deletes it locally', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await logoutCommand.parseAsync([], { from: 'user' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://ais.test/api/auth/cli/token',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(auth.deleteToken).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a failed server-side revocation instead of silently ignoring it', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }),
    );

    await logoutCommand.parseAsync([], { from: 'user' });

    expect(auth.deleteToken).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Internal error');
  });

  it('treats an already invalid token (401) as logged out', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await logoutCommand.parseAsync([], { from: 'user' });

    expect(auth.deleteToken).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
