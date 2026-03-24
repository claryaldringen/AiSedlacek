import sharp from 'sharp';
import { detectMediaType } from './parse.js';
import type { ImageMediaType } from './types.js';

export async function prepareImage(
  image: Buffer,
): Promise<{ buffer: Buffer; mediaType: ImageMediaType }> {
  // API limit is 5 MB for base64-encoded data. Base64 inflates size by ~4/3,
  // so the raw file must be under ~3.75 MB to stay within the 5 MB base64 limit.
  const MAX_BASE64_BYTES = 5 * 1024 * 1024;
  const MAX_RAW_BYTES = Math.floor((MAX_BASE64_BYTES * 3) / 4); // ~3.75 MB
  let imageToSend = image;

  if (image.length > MAX_RAW_BYTES) {
    console.log(
      `[Claude] Image too large (${(image.length / 1024 / 1024).toFixed(1)} MB), resizing…`,
    );
    imageToSend = await sharp(image)
      .resize({ width: 3000, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (imageToSend.length > MAX_RAW_BYTES) {
      imageToSend = await sharp(image)
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    }
    console.log(`[Claude] Resized to ${(imageToSend.length / 1024 / 1024).toFixed(1)} MB`);
  }

  return { buffer: imageToSend, mediaType: detectMediaType(imageToSend) };
}
