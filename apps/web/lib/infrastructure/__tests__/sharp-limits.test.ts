import { describe, it, expect, vi, beforeEach } from 'vitest';

// SEC-13: every sharp() call over user-supplied data must carry
// limitInputPixels. Record the options of each call made on a Buffer input.
const bufferCalls: unknown[] = [];

vi.mock('sharp', async (importOriginal) => {
  const actual = (await importOriginal<typeof import('sharp')>()).default;
  const spy = ((...args: Parameters<typeof actual>) => {
    if (Buffer.isBuffer(args[0])) bufferCalls.push(args[1]);
    return actual(...args);
  }) as typeof actual;
  return { default: Object.assign(spy, actual) };
});

vi.mock('@/lib/adapters/storage', () => ({ getStorage: vi.fn() }));

import sharp from 'sharp';
import { isBlankPage } from '../blank-detection';
import { MAX_INPUT_PIXELS, validateImage } from '../image-validation';

async function scan(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: '#e8dcc0' } })
    .png()
    .toBuffer();
}

describe('sharp calls over user data use the pixel limit', () => {
  beforeEach(() => {
    bufferCalls.length = 0;
  });

  it('validateImage (metadata + thumbnail)', async () => {
    await validateImage(await scan());
    expect(bufferCalls.length).toBeGreaterThanOrEqual(2);
    for (const opts of bufferCalls) {
      expect(opts).toMatchObject({ limitInputPixels: MAX_INPUT_PIXELS });
    }
  });

  it('isBlankPage', async () => {
    const png = await scan();
    bufferCalls.length = 0;
    await isBlankPage(png);
    expect(bufferCalls).toEqual([expect.objectContaining({ limitInputPixels: MAX_INPUT_PIXELS })]);
  });
});
