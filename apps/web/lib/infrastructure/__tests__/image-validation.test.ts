import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  detectImageFormat,
  InvalidImageError,
  isReusableStoredImageUrl,
  validateImage,
} from '../image-validation';

function solid(width = 40, height = 30): sharp.Sharp {
  return sharp({ create: { width, height, channels: 3, background: '#c8b48c' } });
}

async function rejection(promise: Promise<unknown>): Promise<InvalidImageError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidImageError);
    return err as InvalidImageError;
  }
  throw new Error('expected validateImage to reject');
}

const HTML = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script>');
const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
    '<script>alert(1)</script></svg>',
);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

describe('validateImage', () => {
  it.each([
    ['jpeg', 'jpg', 'image/jpeg'],
    ['png', 'png', 'image/png'],
    ['webp', 'webp', 'image/webp'],
    ['tiff', 'tif', 'image/tiff'],
  ] as const)('accepts %s and derives extension .%s', async (format, extension, mimeType) => {
    const buffer = await solid().toFormat(format).toBuffer();
    const image = await validateImage(buffer);
    expect(image).toMatchObject({ format, extension, mimeType, width: 40, height: 30 });
    // Thumbnail is always a JPEG.
    expect(image.thumbnail.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('rejects GIF unless explicitly allowed', async () => {
    const gif = await solid().gif().toBuffer();
    expect((await rejection(validateImage(gif))).reason).toBe('unsupported_format');
    await expect(validateImage(gif, { allowGif: true })).resolves.toMatchObject({
      extension: 'gif',
      mimeType: 'image/gif',
    });
  });

  it.each([
    ['HTML', HTML],
    ['SVG', SVG],
    ['PDF', PDF],
    ['empty file', Buffer.alloc(0)],
  ])('rejects %s as unsupported format', async (_name, buffer) => {
    expect((await rejection(validateImage(buffer))).reason).toBe('unsupported_format');
  });

  it('rejects a JPEG signature followed by non-image data', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), HTML]);
    expect((await rejection(validateImage(fake))).reason).toBe('undecodable');
  });

  it('rejects a truncated image (header OK, pixel data missing)', async () => {
    const png = await solid(400, 400).png({ compressionLevel: 0 }).toBuffer();
    const truncated = png.subarray(0, Math.floor(png.length / 2));
    expect((await rejection(validateImage(truncated))).reason).toBe('undecodable');
  });

  it('rejects when magic bytes and decoded format disagree', async () => {
    // RIFF/WEBP container whose payload is not a WebP bitstream.
    const fake = Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBP', 'latin1'), HTML]);
    await expect(validateImage(fake)).rejects.toBeInstanceOf(InvalidImageError);
  });
});

describe('detectImageFormat', () => {
  it('detects formats from magic bytes only', async () => {
    expect(detectImageFormat(await solid().jpeg().toBuffer())).toBe('jpeg');
    expect(detectImageFormat(await solid().png().toBuffer())).toBe('png');
    expect(detectImageFormat(await solid().webp().toBuffer())).toBe('webp');
    expect(detectImageFormat(await solid().tiff().toBuffer())).toBe('tiff');
    expect(detectImageFormat(await solid().gif().toBuffer())).toBe('gif');
    expect(detectImageFormat(HTML)).toBeNull();
    expect(detectImageFormat(SVG)).toBeNull();
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('isReusableStoredImageUrl', () => {
  it('allows only image extensions', () => {
    expect(isReusableStoredImageUrl('/uploads/8f0c.jpg')).toBe(true);
    expect(isReusableStoredImageUrl('/uploads/8f0c-scan 01.JPEG')).toBe(true);
    expect(isReusableStoredImageUrl('/uploads/8f0c-scan.tiff')).toBe(true);
    expect(isReusableStoredImageUrl('/api/images/8f0c-scan.webp')).toBe(true);
    expect(isReusableStoredImageUrl('/uploads/8f0c-evil.html')).toBe(false);
    expect(isReusableStoredImageUrl('/uploads/8f0c-evil.svg')).toBe(false);
    expect(isReusableStoredImageUrl('/uploads/8f0c-evil.jpg.html')).toBe(false);
    expect(isReusableStoredImageUrl('/uploads/8f0c-noext')).toBe(false);
  });
});
