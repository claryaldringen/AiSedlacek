import { describe, it, expect, afterEach } from 'vitest';
import { LocalStorageProvider } from '../local-storage.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(import.meta.dirname, '../../../../tmp/test-uploads');

describe('LocalStorageProvider', () => {
  const storage = new LocalStorageProvider(TEST_DIR);

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('uploads a file and returns url and path', async () => {
    const buffer = Buffer.from('test image data');
    const result = await storage.upload(buffer, 'test.jpg');
    expect(result.path).toContain('test.jpg');
    expect(result.url).toContain('/tmp/test-uploads/');
    const saved = await fs.readFile(path.join(TEST_DIR, result.path));
    expect(saved).toEqual(buffer);
  });

  it('generates unique filenames to avoid collisions', async () => {
    const buffer = Buffer.from('data');
    const r1 = await storage.upload(buffer, 'file.jpg');
    const r2 = await storage.upload(buffer, 'file.jpg');
    expect(r1.path).not.toBe(r2.path);
  });

  it('deletes a file', async () => {
    const buffer = Buffer.from('data');
    const result = await storage.upload(buffer, 'delete-me.jpg');
    await storage.delete(result.path);
    await expect(fs.access(path.join(TEST_DIR, result.path))).rejects.toThrow();
  });

  it('getUrl returns path-based URL', () => {
    const url = storage.getUrl('abc123-test.jpg');
    expect(url).toContain('abc123-test.jpg');
    expect(url.startsWith('/')).toBe(true);
  });
});
