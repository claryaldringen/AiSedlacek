import { describe, it, expect } from 'vitest';
import { detectImageMimeType } from '../lib/mime.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
const TIFF_LE = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]);
const TIFF_BE = Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08]);
const BIGTIFF = Uint8Array.from([0x49, 0x49, 0x2b, 0x00, 0x08, 0x00]);
const TEXT = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

describe('detectImageMimeType', () => {
  it.each([
    ['jpeg', JPEG, 'image/jpeg'],
    ['png', PNG, 'image/png'],
    ['webp', WEBP, 'image/webp'],
    ['tiff little-endian', TIFF_LE, 'image/tiff'],
    ['tiff big-endian', TIFF_BE, 'image/tiff'],
    ['bigtiff', BIGTIFF, 'image/tiff'],
  ])('detects %s from magic bytes', (_name, bytes, expected) => {
    expect(detectImageMimeType(bytes)).toBe(expected);
  });

  it('returns null for unknown, empty or too short content', () => {
    expect(detectImageMimeType(TEXT)).toBeNull();
    expect(detectImageMimeType(new Uint8Array())).toBeNull();
    // HEIC (ftyp box) přejmenovaný na .jpg
    expect(
      detectImageMimeType(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65])),
    ).toBeNull();
    expect(detectImageMimeType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    // RIFF bez WEBP (např. WAV) není obrázek
    expect(
      detectImageMimeType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56])),
    ).toBeNull();
  });
});
