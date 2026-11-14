import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalStorageProvider } from '../lib/local-storage';

// Kopie LocalStorageProvider z webu (sjednocení je dluh, viz CLAUDE.md) musí taky
// zapisovat atomicky – noční rsync s --ignore-existing by useknutý soubor
// zkopíroval natrvalo.

let dir: string;

afterEach(async () => {
  vi.restoreAllMocks();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function storage(): Promise<LocalStorageProvider> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ais-worker-storage-'));
  return new LocalStorageProvider(dir);
}

describe('LocalStorageProvider (worker) – atomický zápis', () => {
  it('zapisuje do .partial a na finální jméno přejmenuje až kompletní soubor', async () => {
    const s = await storage();
    const rename = fs.rename.bind(fs);
    const seen: { tmp: string; final: string; tmpContent: string; finalExists: boolean }[] = [];
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

    const result = await s.upload(Buffer.from('celý sken'), 'jpg');

    expect(result.path).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(seen).toEqual([
      {
        tmp: path.join(dir, `${result.path}.partial`),
        final: path.join(dir, result.path),
        tmpContent: 'celý sken',
        finalExists: false,
      },
    ]);
    expect(await fs.readdir(dir)).toEqual([result.path]);
    expect((await s.read(result.path)).toString()).toBe('celý sken');
  });

  it('po chybě zápisu dočasný soubor smaže a finální soubor nevznikne', async () => {
    const s = await storage();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    await expect(s.upload(Buffer.from('data'), 'png')).rejects.toThrow('ENOSPC');

    expect(await fs.readdir(dir)).toEqual([]);
  });
});
