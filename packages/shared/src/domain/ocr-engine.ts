import type { OcrEngineResult, OcrEngineName, OcrOptions } from '../types.js';

export interface IOcrEngine {
  readonly name: OcrEngineName;
  readonly role: 'recognizer' | 'segmenter';
  isAvailable(): Promise<boolean>;
  recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult>;
}
