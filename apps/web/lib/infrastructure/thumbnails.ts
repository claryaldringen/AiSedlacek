import type { Sharp } from 'sharp';
import { getStorage } from '@/lib/adapters/storage';

const THUMB_WIDTH = 400;

/**
 * Render a JPEG thumbnail. Takes a prepared sharp instance so the caller
 * controls the input limits (see sharpForUntrustedInput). Throws if the image
 * cannot be decoded – image-validation relies on that to reject corrupt files.
 */
export async function renderThumbnail(image: Sharp): Promise<Buffer> {
  return image
    .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
}

/** Store a rendered thumbnail and return its URL. */
export async function saveThumbnail(thumbnail: Buffer): Promise<string> {
  const result = await getStorage().upload(thumbnail, 'jpg');
  return result.url;
}
