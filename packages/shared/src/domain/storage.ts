export interface StorageResult {
  url: string;
  path: string;
}

export interface IStorageProvider {
  upload(file: Buffer, filename: string): Promise<StorageResult>;
  read(path: string): Promise<Buffer>;
  getUrl(path: string): string;
  delete(path: string): Promise<void>;
}
