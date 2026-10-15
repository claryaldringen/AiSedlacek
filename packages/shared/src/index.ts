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
export type { IStorageProvider, StorageResult, StoredImageExtension } from './domain/storage';
export { STORED_IMAGE_EXTENSIONS } from './domain/storage';
export type { IEmailProvider } from './domain/email';

export {
  CLASSIFY_LAYOUT_PROMPT,
  OCR_TRANSCRIPTION_PROMPT,
  buildConsolidationPrompt,
  buildPolishPrompt,
  BATCH_OCR_INSTRUCTION,
  TRANSLATE_ONLY_SYSTEM_PROMPT,
} from './prompts';

export { TRANSLATION_LANGUAGES, isTranslationLanguage } from './languages';
export type { TranslationLanguage } from './languages';
export { OCR_MODEL, OCR_EFFORT, TEXT_MODEL } from './models';
export {
  MODEL_PRICING_USD,
  BILLING,
  modelRates,
  usageCostUsd,
  usagePriceCzk,
  creditsForUsage,
  czkToCredits,
  creditsToCzk,
  BILLED_PRE_OUTPUT_REFUSAL_CATEGORIES,
  isRefusalBilled,
} from './pricing';
