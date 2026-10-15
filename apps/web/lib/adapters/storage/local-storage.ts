import { STORED_IMAGE_EXTENSIONS } from '@ai-sedlacek/shared';
import type { IStorageProvider, StorageResult, StoredImageExtension } from '@ai-sedlacek/shared';
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

  /**
   * Store under `<uuid>.<extension>`. The client's filename never reaches the
   * disk: Caddy serves /uploads/* straight from this directory and picks the
   * Content-Type by extension, so only image extensions may be written. The
   * runtime check backs up the type for callers that bypass it (casts, JS).
   */
  async upload(file: Buffer, extension: StoredImageExtension): Promise<StorageResult> {
    if (!(STORED_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new Error(`Refusing to store file with extension "${String(extension)}"`);
    }
    await fs.mkdir(this.uploadDir, { recursive: true });
    const uniqueName = `${crypto.randomUUID()}.${extension}`;
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
