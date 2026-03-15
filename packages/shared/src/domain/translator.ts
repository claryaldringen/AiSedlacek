import type { OcrEngineResult, ConsolidationResult } from '../types.js';

export interface ITranslator {
  consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult>;
  polish(literalTranslation: string, targetLanguage: string): Promise<string>;
}
