import type {
  IPreprocessor,
  ILayoutClassifier,
  IOcrEngine,
  ITranslator,
  ProcessingResult,
} from '@ai-sedlacek/shared';
import crypto from 'crypto';
import { EnsembleOrchestrator } from './ensemble';

export class ProcessDocument {
  private readonly ensemble: EnsembleOrchestrator;

  constructor(
    private readonly preprocessor: IPreprocessor,
    private readonly classifier: ILayoutClassifier,
    engines: IOcrEngine[],
    private readonly translator: ITranslator,
  ) {
    this.ensemble = new EnsembleOrchestrator(engines);
  }

  async execute(
    imageBuffer: Buffer,
    originalImageUrl: string,
    targetLanguage: string,
  ): Promise<ProcessingResult> {
    // Step 1: Preprocess image (for Tesseract – Claude Vision gets the original)
    const processedImage = await this.preprocessor.process(imageBuffer);

    // Step 2: Classification temporarily skipped – context was too generic to help OCR
    const classification = {
      tier: 'tier1' as const,
      scriptType: 'manuscript' as const,
      layoutComplexity: 'simple' as const,
      detectedFeatures: [] as string[],
      confidence: 0,
      reasoning: 'Klasifikace přeskočena',
    };

    // Step 3: Run OCR ensemble (no classification context – let models figure it out)
    const ocrResults = await this.ensemble.run(imageBuffer, processedImage);

    // Step 4: Consolidation and translation are temporarily disabled
    // TODO: Re-enable once OCR quality is sufficient
    const consolidatedText = '';
    const literalTranslation = '';
    const polishedTranslation = '';
    const confidenceNotes: string[] = ['Konsolidace a překlad dočasně vypnuty – probíhá ladění OCR'];

    // Step 6: Detect language from OCR results (use first recognizer engine output)
    const detectedLanguage = this.detectLanguage(ocrResults);

    return {
      id: crypto.randomUUID(),
      originalImage: originalImageUrl,
      classification,
      ocrResults,
      consolidatedText,
      literalTranslation,
      polishedTranslation,
      detectedLanguage,
      confidenceNotes,
    };
  }

  private detectLanguage(ocrResults: ProcessingResult['ocrResults']): string {
    const recognizerResult = ocrResults.find((r) => r.role === 'recognizer');
    if (!recognizerResult) {
      return 'neznámý';
    }
    // Basic heuristic: use engine name as language hint placeholder.
    // A real implementation would parse OCR output for language markers.
    return 'středověká čeština/němčina/latina';
  }
}
