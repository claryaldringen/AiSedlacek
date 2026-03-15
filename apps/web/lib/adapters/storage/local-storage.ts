import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  constructor(private readonly uploadDir: string = 'tmp/uploads') {}

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    const uniqueName = `${crypto.randomUUID()}-${filename}`;
    const filePath = path.join(this.uploadDir, uniqueName);
    await fs.writeFile(filePath, file);
    return { url: `/${filePath}`, path: uniqueName };
  }

  getUrl(filePath: string): string {
    return `/${this.uploadDir}/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, filePath));
  }
}
