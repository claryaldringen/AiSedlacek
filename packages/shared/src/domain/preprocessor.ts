export interface IPreprocessor {
  process(image: Buffer): Promise<Buffer>;
}
