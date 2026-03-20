import sharp from 'sharp';
import { getStorage } from '@/lib/adapters/storage';

const THUMB_WIDTH = 400;

/**
 * Generate a JPEG thumbnail from image buffer and save it to storage.
 * Returns the thumbnail URL or null if generation fails.
 */
export async function generateThumbnail(
  buffer: Buffer,
  originalFilename: string,
): Promise<string | null> {
  try {
    const thumbBuffer = await sharp(buffer)
      .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const storage = getStorage();
    const thumbFilename = originalFilename.replace(/\.[^.]+$/, '') + '_thumb.jpg';
    const result = await storage.upload(thumbBuffer, thumbFilename);
    return result.url;
  } catch {
    return null;
  }
}
