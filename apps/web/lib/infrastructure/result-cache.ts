import type { ProcessingResult } from '@ai-sedlacek/shared';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = 'tmp/cache';

export function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function getCachedResult(hash: string): Promise<ProcessingResult | null> {
  try {
    const data = await fs.readFile(path.join(CACHE_DIR, `${hash}.json`), 'utf-8');
    return JSON.parse(data) as ProcessingResult;
  } catch {
    return null;
  }
}

export async function cacheResult(hash: string, result: ProcessingResult): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(result));
}
