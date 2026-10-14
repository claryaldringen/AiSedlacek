/** Formáty, které server přijímá v POST /api/pages/upload. */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff';

function startsWith(buffer: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/**
 * MIME typ obrázku podle signatury (magic bytes) na začátku souboru.
 *
 * Přípona se záměrně nepoužívá: všechny podporované formáty mají spolehlivou
 * signaturu, takže soubor bez ní je poškozený nebo v jiném formátu (např. HEIC
 * přejmenovaný na .jpg) a server by ho stejně nezpracoval. Vrací null pro
 * nepodporovaný obsah.
 */
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
  // TIFF little-endian (II*\0) a big-endian (MM\0*), BigTIFF (II+\0, MM\0+)
  if (
    startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a]) ||
    startsWith(buffer, [0x49, 0x49, 0x2b, 0x00]) ||
    startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2b])
  ) {
    return 'image/tiff';
  }
  return null;
}
