import sharp, { type Metadata, type Sharp } from 'sharp';
import { STORED_IMAGE_EXTENSIONS, type StoredImageExtension } from '@ai-sedlacek/shared';
import { renderThumbnail } from './thumbnails';

/**
 * Validation of user-supplied images (multipart upload, URL import, CLI
 * upload-url). Caddy serves /uploads/* straight from disk and derives the
 * Content-Type from the file extension, so the format is decided from the
 * file CONTENT only – never from `File.type`, the Content-Type header, the
 * client filename or Content-Disposition – and the stored name gets the
 * extension of the detected format (see IStorageProvider.upload).
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'tiff' | 'gif';

const FORMAT_INFO: Record<ImageFormat, { extension: StoredImageExtension; mimeType: string }> = {
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
  webp: { extension: 'webp', mimeType: 'image/webp' },
  tiff: { extension: 'tif', mimeType: 'image/tiff' },
  gif: { extension: 'gif', mimeType: 'image/gif' },
};

/**
 * Upper bound on width × height for every sharp call over user data (SEC-13).
 * sharp's default (~268 Mpx) lets a small, highly compressible PNG/TIFF expand
 * to ~1 GB when decoded – a decompression bomb for the web process, which PM2
 * restarts at 500 MB. 100 Mpx still covers large-format manuscript scans
 * (A3 at 600 dpi ≈ 70 Mpx, 10 000 × 10 000 px) while capping a worst-case full
 * decode (non-streamable input, 4 B/px) at ~400 MB. Uploads are also capped at
 * MAX_FILE_SIZE_MB, which in practice keeps legitimate JPEGs well below this.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

export type InvalidImageReason = 'unsupported_format' | 'undecodable' | 'too_many_pixels';

export class InvalidImageError extends Error {
  readonly reason: InvalidImageReason;

  constructor(reason: InvalidImageReason, detail?: string) {
    super(detail ? `Invalid image (${reason}): ${detail}` : `Invalid image (${reason})`);
    this.name = 'InvalidImageError';
    this.reason = reason;
  }
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Localized message (namespace `api`) for an invalid-image rejection. */
export function invalidImageMessage(err: InvalidImageError, t: Translate): string {
  switch (err.reason) {
    case 'unsupported_format':
      return t('unsupportedFormat');
    case 'too_many_pixels':
      return t('imageTooManyPixels', { max: MAX_INPUT_PIXELS / 1_000_000 });
    default:
      return t('invalidImage');
  }
}

/**
 * sharp instance for untrusted input – use it for EVERY sharp call over user
 * data (uploads, stored uploads). `limitInputPixels` is checked from the header
 * before decoding. `failOn: 'error'` rejects truncated and corrupt pixel data
 * but tolerates mere decoder warnings that real-world scanner output triggers.
 */
export function sharpForUntrustedInput(input: Buffer): Sharp {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Classic TIFF and BigTIFF, little and big endian.
const TIFF_SIGNATURES = ['49492a00', '4d4d002a', '49492b00', '4d4d002b'];

/**
 * Detect an allowed image format from magic bytes. Runs before sharp so that
 * libvips never parses anything else (SVG, PDF, HEIF, ...) – smaller attack
 * surface than letting the decoder sniff arbitrary content.
 */
export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (buf.length >= 4 && TIFF_SIGNATURES.includes(buf.subarray(0, 4).toString('hex'))) {
    return 'tiff';
  }
  if (buf.length >= 6) {
    const sig = buf.toString('latin1', 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'gif';
  }
  return null;
}

export interface ValidatedImage {
  format: ImageFormat;
  /** Extension to store the file under – derived from the detected format. */
  extension: StoredImageExtension;
  mimeType: string;
  width: number;
  height: number;
  /** JPEG thumbnail; rendering it is what proves the whole image decodes. */
  thumbnail: Buffer;
}

function toInvalidImageError(err: unknown): InvalidImageError {
  if (err instanceof InvalidImageError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // sharp: "Input image exceeds pixel limit"
  const reason = /pixel limit/i.test(message) ? 'too_many_pixels' : 'undecodable';
  return new InvalidImageError(reason, message);
}

/**
 * Verify that `buffer` is a decodable JPEG, PNG, WebP or TIFF (GIF only when
 * `allowGif`) and return its format, dimensions and a thumbnail. Throws
 * InvalidImageError otherwise. Call it BEFORE writing anything to storage.
 */
export async function validateImage(
  buffer: Buffer,
  options: { allowGif?: boolean } = {},
): Promise<ValidatedImage> {
  const format = detectImageFormat(buffer);
  if (!format || (format === 'gif' && !options.allowGif)) {
    throw new InvalidImageError('unsupported_format');
  }

  let metadata: Metadata;
  try {
    metadata = await sharpForUntrustedInput(buffer).metadata();
  } catch (err) {
    throw toInvalidImageError(err);
  }
  // libvips sniffs the content on its own – both detectors must agree.
  if (metadata.format !== format) {
    throw new InvalidImageError('unsupported_format', `detected ${String(metadata.format)}`);
  }
  const { width, height } = metadata;
  if (!width || !height) throw new InvalidImageError('undecodable', 'missing dimensions');

  // metadata() reads only the header. Rendering the thumbnail decodes all pixel
  // data, so a valid header followed by garbage or a truncated file fails here.
  let thumbnail: Buffer;
  try {
    thumbnail = await renderThumbnail(sharpForUntrustedInput(buffer));
  } catch (err) {
    throw toInvalidImageError(err);
  }

  const { extension, mimeType } = FORMAT_INFO[format];
  return { format, extension, mimeType, width, height, thumbnail };
}

/**
 * True if an already stored file (cross-user dedup by hash) may be reused for
 * a new page: only files whose name ends in an image extension. Files stored
 * before content validation kept the client's extension (.html, .svg) and must
 * not be handed out again.
 */
export function isReusableStoredImageUrl(imageUrl: string): boolean {
  const ext = imageUrl.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext) return false;
  return (
    (STORED_IMAGE_EXTENSIONS as readonly string[]).includes(ext) || ext === 'jpeg' || ext === 'tiff'
  );
}
