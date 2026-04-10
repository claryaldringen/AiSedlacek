import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  private readonly uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir ?? process.env['UPLOAD_DIR'] ?? 'tmp/uploads';
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
    return fs.readFile(path.join(this.uploadDir, filePath));
  }

  getUrl(filePath: string): string {
    return `/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, filePath));
  }
}
