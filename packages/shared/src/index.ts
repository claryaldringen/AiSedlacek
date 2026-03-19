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
} from './types';

export type { IOcrEngine } from './domain/ocr-engine';
export type { ITranslator } from './domain/translator';
export type { IPreprocessor } from './domain/preprocessor';
export type { ILayoutClassifier } from './domain/classifier';
export type { IStorageProvider, StorageResult } from './domain/storage';

export {
  CLASSIFY_LAYOUT_PROMPT,
  OCR_TRANSCRIPTION_PROMPT,
  buildConsolidationPrompt,
  buildPolishPrompt,
  BATCH_OCR_INSTRUCTION,
  TRANSLATE_ONLY_SYSTEM_PROMPT,
} from './prompts';
