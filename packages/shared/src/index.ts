export type {
  OcrTier,
  OcrEngineName,
  DocumentClassification,
  BoundingBox,
  SegmentedLine,
  OcrEngineResult,
  ProcessingResult,
  ConsolidationResult,
  OcrOptions,
  TranskribusConfig,
  KrakenConfig,
  OllamaConfig,
} from './types.js';

export type { IOcrEngine } from './domain/ocr-engine.js';
export type { ITranslator } from './domain/translator.js';
export type { IPreprocessor } from './domain/preprocessor.js';
export type { ILayoutClassifier } from './domain/classifier.js';
export type { IStorageProvider } from './domain/storage.js';

export {
  CLASSIFY_LAYOUT_PROMPT,
  OCR_TRANSCRIPTION_PROMPT,
  buildConsolidationPrompt,
  buildPolishPrompt,
} from './prompts.js';
