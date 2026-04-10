import type { IStorageProvider } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from './local-storage';

let cached: IStorageProvider | null = null;

export function getStorage(): IStorageProvider {
  if (cached) return cached;
  cached = new LocalStorageProvider();
  return cached;
}
