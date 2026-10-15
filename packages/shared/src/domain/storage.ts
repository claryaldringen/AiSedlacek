export interface StorageResult {
  url: string;
  path: string;
}

/**
 * The only file extensions a storage provider may write. Uploaded files are
 * served straight from disk by the reverse proxy, which derives Content-Type
 * from the extension – a user-controlled extension (.html, .svg) would turn an
 * upload into active content on the application origin (stored XSS).
 */
export const STORED_IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'tif', 'gif'] as const;

export type StoredImageExtension = (typeof STORED_IMAGE_EXTENSIONS)[number];

export interface IStorageProvider {
  /**
   * Store an image under a fresh random name `<uuid>.<extension>`. The caller
   * must derive `extension` from the detected file content, never from a
   * client-supplied filename, Content-Type or Content-Disposition.
   */
  upload(file: Buffer, extension: StoredImageExtension): Promise<StorageResult>;
  read(path: string): Promise<Buffer>;
  getUrl(path: string): string;
  delete(path: string): Promise<void>;
}
