export type ProcessingMode = 'transcribe+translate' | 'translate';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface StructuredOcrResult {
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
}
