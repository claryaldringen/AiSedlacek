import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import cs from '@/messages/cs.json';

// S2-5: limit těla uploadu musí platit i bez hlavičky Content-Length
// (chunked / HTTP/2) – formData() by jinak bufferovalo neomezené tělo.

vi.mock('@/lib/infrastructure/db', () => ({ prisma: { page: {} } }));
vi.mock('@/lib/infrastructure/auth-utils', () => ({
  resolveUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/infrastructure/authz', () => ({ getOwnedCollection: vi.fn() }));
const mockUpload = vi.fn();
vi.mock('@/lib/adapters/storage', () => ({
  getStorage: () => ({ upload: (...args: unknown[]) => mockUpload(...args) }),
}));

let upload: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  // Limit 1 MB na soubor → strop requestu 2 MB (1 soubor + režie formuláře);
  // test tak nemusí alokovat 20 MB.
  vi.stubEnv('MAX_FILE_SIZE_MB', '1');
  vi.resetModules();
  ({ POST: upload } = await import('@/app/api/pages/upload/route'));
});

describe('POST /api/pages/upload – body limit without Content-Length', () => {
  it('rejects an oversized body even when Content-Length is missing', async () => {
    const form = new FormData();
    form.append('files', new File([new Uint8Array(7 * 1024 * 1024)], 'big.jpg'));
    const encoded = new Response(form);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    // Tělo jako stream po 64 KB bez Content-Length (jako chunked request) –
    // pull() respektuje zrušení čtení po překročení limitu.
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
        offset += 64 * 1024;
      },
    });
    const req = new NextRequest('http://localhost/api/pages/upload', {
      method: 'POST',
      body: stream,
      headers: {
        'x-locale': 'cs',
        'content-type': encoded.headers.get('content-type')!,
      },
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect(req.headers.get('content-length')).toBeNull();

    const res = await upload(req);

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(cs.api.requestTooLarge);
    expect(mockUpload).not.toHaveBeenCalled();
    // Čtení se po překročení limitu přerušilo – zbytek těla se nenačetl.
    expect(offset).toBeLessThan(bytes.length);
  });
});
