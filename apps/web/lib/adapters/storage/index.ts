import type { IStorageProvider } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from './local-storage';
import { R2StorageProvider } from './r2-storage';

let cached: IStorageProvider | null = null;

export function getStorage(): IStorageProvider {
  if (cached) return cached;

  cached = process.env['R2_ACCESS_KEY_ID']
    ? new R2StorageProvider()
    : new LocalStorageProvider();

  return cached;
}

export function isRemoteStorage(): boolean {
  return !!process.env['R2_ACCESS_KEY_ID'];
}
