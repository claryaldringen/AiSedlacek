import * as path from 'node:path';

/** Formáty, které server přijímá v POST /api/pages/upload. */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff';

const EXTENSION_TYPES: Record<string, ImageMimeType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

function startsWith(buffer: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/** Rozpozná formát podle signatury (magic bytes) na začátku souboru. */
export function detectImageMimeType(buffer: Uint8Array): ImageMimeType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  // TIFF little-endian (II*\0) a big-endian (MM\0*)
  if (
    startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return 'image/tiff';
  }
  return null;
}

/**
 * MIME typ pro nahrání lokálního souboru: přednost má obsah (signatura), přípona je
 * jen záloha. Vrací null pro nepodporovaný formát – takový soubor nemá smysl posílat.
 */
export function imageMimeTypeForFile(filePath: string, buffer: Uint8Array): ImageMimeType | null {
  return (
    detectImageMimeType(buffer) ?? EXTENSION_TYPES[path.extname(filePath).toLowerCase()] ?? null
  );
}
