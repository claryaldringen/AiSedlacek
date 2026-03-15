export interface IStorageProvider {
  upload(filename: string, data: Buffer, contentType: string): Promise<string>;
  download(url: string): Promise<Buffer>;
  delete(url: string): Promise<void>;
}
