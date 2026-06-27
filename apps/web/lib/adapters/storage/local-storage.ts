import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  private readonly uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir ?? process.env['UPLOAD_DIR'] ?? 'tmp/uploads';
  }

  /**
   * Resolve a caller-supplied relative path inside the upload dir, rejecting any
   * attempt to escape it (`..`, absolute paths, symlink-style tricks). Without
   * this, the unauthenticated /api/images/[...path] route would allow reading
   * arbitrary files (e.g. .env, /etc/passwd) via path traversal.
   */
  private resolveWithin(filePath: string): string {
    const base = path.resolve(this.uploadDir);
    const full = path.resolve(base, filePath);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error('Path escapes upload directory');
    }
    return full;
  }

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    const safeName = filename.replace(/[/\\]/g, '_');
    const uniqueName = `${crypto.randomUUID()}-${safeName}`;
    const filePath = path.join(this.uploadDir, uniqueName);
    await fs.writeFile(filePath, file);
    return { url: `/uploads/${uniqueName}`, path: uniqueName };
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.readFile(this.resolveWithin(filePath));
  }

  getUrl(filePath: string): string {
    return `/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(this.resolveWithin(filePath));
  }
}
