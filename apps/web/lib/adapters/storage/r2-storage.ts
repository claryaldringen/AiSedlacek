import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';

export class R2StorageProvider implements IStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor() {
    const accountId = process.env['R2_ACCOUNT_ID'];
    const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing R2 configuration: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
      );
    }

    this.bucket = process.env['R2_BUCKET_NAME'] ?? 'ai-sedlacek';
    this.publicUrl = process.env['R2_PUBLIC_URL'] ?? '';

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    const safeName = filename.replace(/[/\\]/g, '_');
    const key = `${crypto.randomUUID()}-${safeName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: this.detectContentType(filename),
      }),
    );

    const url = this.publicUrl ? `${this.publicUrl}/${key}` : key;
    return { url, path: key };
  }

  async read(pathOrUrl: string): Promise<Buffer> {
    const key = this.extractKey(pathOrUrl);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Empty response for key: ${key}`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  getUrl(pathOrUrl: string): string {
    if (this.publicUrl) {
      const key = this.extractKey(pathOrUrl);
      return `${this.publicUrl}/${key}`;
    }
    return pathOrUrl;
  }

  async delete(pathOrUrl: string): Promise<void> {
    const key = this.extractKey(pathOrUrl);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  private extractKey(pathOrUrl: string): string {
    if (this.publicUrl && pathOrUrl.startsWith(this.publicUrl)) {
      return pathOrUrl.slice(this.publicUrl.length + 1);
    }
    return pathOrUrl;
  }

  private detectContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'tiff':
      case 'tif':
        return 'image/tiff';
      default:
        return 'application/octet-stream';
    }
  }
}
