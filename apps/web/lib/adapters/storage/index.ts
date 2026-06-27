import type { IStorageProvider } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from './local-storage';

let cached: IStorageProvider | null = null;

export function getStorage(): IStorageProvider {
  if (cached) return cached;
  cached = new LocalStorageProvider();
  return cached;
}

/**
 * Derive the storage key (the bare filename used by read/delete) from a stored
 * `imageUrl`. Images are stored as `/uploads/<key>`; older rows used
 * `/api/images/<key>`. Stripping the wrong prefix left the full URL in place,
 * so deletes silently no-opped and left orphaned files on disk.
 */
export function storageKeyFromImageUrl(imageUrl: string): string {
  return imageUrl.replace(/^\/uploads\//, '').replace(/^\/api\/images\//, '');
}
