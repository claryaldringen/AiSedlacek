export type OcrTier = 'tier1' | 'tier2';

export type OcrEngineName = 'transkribus' | 'tesseract' | 'kraken' | 'claude_vision' | 'ollama_vision';

export interface DocumentClassification {
  tier: OcrTier;
  scriptType: 'print' | 'manuscript';
  layoutComplexity: 'simple' | 'complex';
  detectedFeatures: string[];
  confidence: number;
  reasoning: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentedLine {
  id: string;
  baseline: [number, number][];
  boundingBox: BoundingBox;
  imageSlice: Buffer;
  text?: string;
}

export interface OcrEngineResult {
  engine: OcrEngineName;
  role: 'recognizer' | 'segmenter';
  text: string;
  lines?: SegmentedLine[];
  confidence?: number;
  uncertainMarkers?: string[];
  processingTimeMs: number;
  costUsd?: number;
}

export interface ProcessingResult {
  id: string;
  originalImage: string;
  classification: DocumentClassification;
  ocrResults: OcrEngineResult[];
  consolidatedText: string;
  literalTranslation: string;
  polishedTranslation: string;
  detectedLanguage: string;
  confidenceNotes: string[];
}

export interface ConsolidationResult {
  consolidatedText: string;
  literalTranslation: string;
  notes: string[];
}

export interface OcrOptions {
  language?: string;
  tier?: OcrTier;
}

export interface TranskribusConfig {
  modelId: string;
  lineDetection: boolean;
}

export interface KrakenConfig {
  segmentationModel: string;
  recognitionModel?: string;
  baseUrl: string;
  device: 'cpu' | 'cuda';
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}
