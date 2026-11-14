import { describe, it, expect, afterEach, vi } from 'vitest';
import type { StoredImageExtension } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from '../local-storage.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(import.meta.dirname, '../../../../tmp/test-uploads');

describe('LocalStorageProvider', () => {
  const storage = new LocalStorageProvider(TEST_DIR);

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  // Noční rsync s --ignore-existing by useknutý soubor zkopíroval natrvalo –
  // pod finálním jménem smí ležet jen kompletně zapsaný soubor.
  it('writes into a .partial file and renames it to the final name only when complete', async () => {
    const buffer = Buffer.from('complete image data');
    const rename = fs.rename.bind(fs);
    const seen: { tmpContent: string; finalExists: boolean; tmp: string; final: string }[] = [];
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      seen.push({
        tmp: String(from),
        final: String(to),
        tmpContent: (await fs.readFile(from)).toString(),
        finalExists: await fs.access(to).then(
          () => true,
          () => false,
        ),
      });
      return rename(from, to);
    });

    const result = await storage.upload(buffer, 'jpg');

    expect(seen).toEqual([
      {
        tmp: path.join(TEST_DIR, `${result.path}.partial`),
        final: path.join(TEST_DIR, result.path),
        tmpContent: 'complete image data',
        finalExists: false,
      },
    ]);
    expect(await fs.readdir(TEST_DIR)).toEqual([result.path]);
  });

  it('removes the temporary file and leaves no final file when the write fails', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('EIO: i/o error'));

    await expect(storage.upload(Buffer.from('data'), 'png')).rejects.toThrow('EIO');

    expect(await fs.readdir(TEST_DIR)).toEqual([]);
  });

  it('uploads a file and returns url and path', async () => {
    const buffer = Buffer.from('test image data');
    const result = await storage.upload(buffer, 'jpg');
    expect(result.url).toBe(`/uploads/${result.path}`);
    const saved = await fs.readFile(path.join(TEST_DIR, result.path));
    expect(saved).toEqual(buffer);
  });

  it('names the stored file <uuid>.<extension> – no client-controlled part', async () => {
    for (const ext of ['jpg', 'png', 'webp', 'tif', 'gif'] as const) {
      const result = await storage.upload(Buffer.from('x'), ext);
      expect(result.path).toMatch(
        new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`),
      );
    }
  });

  it('refuses to store a non-image extension', async () => {
    for (const ext of ['html', 'svg', 'jpg/../../x', 'php', '']) {
      await expect(
        storage.upload(Buffer.from('<script>alert(1)</script>'), ext as StoredImageExtension),
      ).rejects.toThrow(/Refusing to store/);
    }
    const written = await fs.readdir(TEST_DIR).catch(() => []);
    expect(written).toEqual([]);
  });

  it('rejects path traversal in read', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow();
    await expect(storage.read('/etc/passwd')).rejects.toThrow();
    await expect(storage.read('a/../../secret')).rejects.toThrow();
  });

  it('rejects path traversal in delete', async () => {
    await expect(storage.delete('../../etc/passwd')).rejects.toThrow();
    await expect(storage.delete('/etc/passwd')).rejects.toThrow();
  });

  it('generates unique filenames to avoid collisions', async () => {
    const buffer = Buffer.from('data');
    const r1 = await storage.upload(buffer, 'jpg');
    const r2 = await storage.upload(buffer, 'jpg');
    expect(r1.path).not.toBe(r2.path);
  });

  it('deletes a file', async () => {
    const buffer = Buffer.from('data');
    const result = await storage.upload(buffer, 'jpg');
    await storage.delete(result.path);
    await expect(fs.access(path.join(TEST_DIR, result.path))).rejects.toThrow();
  });

  it('getUrl returns path-based URL', () => {
    const url = storage.getUrl('abc123-test.jpg');
    expect(url).toContain('abc123-test.jpg');
    expect(url.startsWith('/')).toBe(true);
  });
});
